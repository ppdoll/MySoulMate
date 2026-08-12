#!/usr/bin/env bash
# 마이그레이션 검증 + 크레딧 동시성 테스트 (WSL / Linux)
#
#   Windows에서:  wsl bash supabase/test/run.sh
#   WSL 안에서:   bash supabase/test/run.sh
#
# /tmp에 일회용 Postgres 클러스터를 새로 만들어 쓰고 끝나면 지운다.
# 기존에 돌고 있는 클러스터(보통 5432)와 그 안의 데이터는 건드리지 않는다.
#
# 하는 일:
#   1. Supabase 기본 객체(auth.users 등)를 스텁으로 만든다
#   2. supabase/migrations/*.sql 를 순서대로 적용한다
#   3. 잔액 5인 계정에 동시 차감 20건을 던진다
#   4. 정확히 5건만 통과했고 원장 합계 == 잔액인지 검증한다
set -euo pipefail

RUNDIR=/tmp/msm-pgtest
DATA=$RUNDIR/data
PORT=55432
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# ---------------------------------------------------------------- 준비

if [ -z "${PGVER:-}" ]; then
  PGVER=$(ls /usr/lib/postgresql/ 2>/dev/null | sort -n | tail -1 || true)
fi
if [ -z "$PGVER" ]; then
  echo "PostgreSQL이 설치돼 있지 않습니다. WSL에서:" >&2
  echo "  sudo apt-get install -y postgresql postgresql-contrib" >&2
  exit 1
fi
PGBIN=/usr/lib/postgresql/$PGVER/bin

# postgres 서버는 root로 실행되지 않는다. postgres 계정으로 넘겨준다.
as_pg() {
  case "$(id -un)" in
    postgres) bash -c "$1" ;;
    root)     su postgres -c "$1" ;;
    *)        sudo -u postgres bash -c "$1" ;;
  esac
}

psql_run() { psql -h "$RUNDIR" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }

cleanup() {
  as_pg "$PGBIN/pg_ctl -D $DATA -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "$RUNDIR"
}
trap cleanup EXIT
cleanup

echo "==> 일회용 클러스터 생성 (PostgreSQL $PGVER, port $PORT)"
mkdir -p "$RUNDIR"
chown postgres:postgres "$RUNDIR" 2>/dev/null || true

as_pg "$PGBIN/initdb -D $DATA -U postgres --auth=trust -E UTF8" >/dev/null
# TCP는 열지 않는다. $RUNDIR 안의 유닉스 소켓으로만 붙어 포트 충돌을 피한다.
as_pg "$PGBIN/pg_ctl -D $DATA -l $RUNDIR/server.log -w -o \"-p $PORT -k $RUNDIR -c listen_addresses=''\" start" >/dev/null

# ---------------------------------------------------------------- 적용

echo "==> Supabase 객체 스텁"
psql_run -f "$ROOT/supabase/test/00_bootstrap.sql"

# pgvector는 Ubuntu 기본 저장소에 없고 PGDG를 붙여야 들어온다.
# 없는 환경에서도 나머지를 검증할 수 있게, 있으면 원본 그대로 쓰고 없으면 text로 치환한다.
#   sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
#   sudo apt-get install -y postgresql-$PGVER-pgvector
if [ -f "/usr/share/postgresql/$PGVER/extension/vector.control" ]; then
  HAS_PGVECTOR=1
else
  HAS_PGVECTOR=0
fi

apply_migration() {
  if [ "$HAS_PGVECTOR" = "1" ]; then
    psql_run -f "$1"
  else
    sed -e '/create extension if not exists vector/d' \
        -e 's/extensions\.vector(768)/text/g' "$1" | psql_run -f -
  fi
}

if [ "$HAS_PGVECTOR" = "1" ]; then
  echo "==> 마이그레이션 적용  (pgvector 있음 - 원본 그대로)"
else
  echo "==> 마이그레이션 적용  (pgvector 없음 - embedding 컬럼을 text로 치환)"
fi
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "    $(basename "$f")"
  apply_migration "$f"
done

# pgvector가 있을 때만 확인할 수 있는 것: embedding 컬럼이 진짜 vector(768)로 만들어졌는지.
if [ "$HAS_PGVECTOR" = "1" ]; then
  EMBED_TYPE=$(psql -h "$RUNDIR" -p "$PORT" -U postgres -d postgres -tAc \
    "select format_type(atttypid, atttypmod) from pg_attribute
      where attrelid = 'public.memories'::regclass and attname = 'embedding'")
  # extensions 스키마가 search_path에 없으면 format_type이 'extensions.vector(768)'로
  # 스키마까지 붙여서 돌려준다. 스키마 접두사를 떼고 비교한다.
  if [ "${EMBED_TYPE##*.}" != "vector(768)" ]; then
    echo "FAIL: memories.embedding 타입이 vector(768)이 아니라 '$EMBED_TYPE' 입니다" >&2
    exit 1
  fi
  echo "    memories.embedding = $EMBED_TYPE"
fi

echo "==> 시드 (결제로 5크레딧 지급)"
psql_run -f "$ROOT/supabase/test/01_seed.sql"

# ---------------------------------------------------------------- 동시성

echo "==> 동시 차감 20건 (클라이언트 20, 각 1회)"
# 잔액이 바닥난 뒤 요청은 45001로 실패하는 게 정상이다. pgbench 종료 코드는 무시한다.
BENCH_OUT=$(pgbench -h "$RUNDIR" -p "$PORT" -U postgres -d postgres \
  -c 20 -j 4 -t 1 -n -f "$ROOT/supabase/test/02_spend.bench.sql" 2>&1 || true)

echo "    $(echo "$BENCH_OUT" | grep -c 'insufficient_credits')건 크레딧 부족으로 거절 (정상)"
echo "$BENCH_OUT" | grep 'transactions actually processed' | sed 's/^/    /'

# 크레딧 부족 말고 다른 이유로 실패했다면 잠금이나 함수 로직이 깨진 것이다.
UNEXPECTED=$(echo "$BENCH_OUT" | grep -E 'ERROR|FATAL' | grep -v 'insufficient_credits' || true)
if [ -n "$UNEXPECTED" ]; then
  echo "예상치 못한 오류:" >&2
  echo "$UNEXPECTED" >&2
  exit 1
fi

echo "==> 검증 (크레딧)"
psql_run -f "$ROOT/supabase/test/03_assert.sql"

echo "==> 검증 (소울메이트 생성 트랜잭션)"
psql_run -f "$ROOT/supabase/test/04_soulmate.sql"

echo "==> 검증 (메시지 순서)"
psql_run -f "$ROOT/supabase/test/05_message_order.sql"

echo "==> 검증 (무료 쿼터)"
psql_run -f "$ROOT/supabase/test/06_free_quota.sql"

echo "==> 검증 (장기 기억)"
psql_run -f "$ROOT/supabase/test/07_memories.sql"

echo "==> 검증 (기억 고정)"
psql_run -f "$ROOT/supabase/test/08_memory_pin.sql"

echo "==> 검증 (되돌린 응답 기록)"
psql_run -f "$ROOT/supabase/test/09_rejected.sql"

echo "==> 검증 (미션 보상 / 출석 연속)"
psql_run -f "$ROOT/supabase/test/10_missions.sql"

echo
echo "완료."

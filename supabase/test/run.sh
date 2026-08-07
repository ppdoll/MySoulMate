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

# 로컬 Postgres에는 pgvector가 없다(PGDG 저장소를 따로 붙여야 한다).
# memories.embedding은 v1에서 쓰지 않는 컬럼이라, 로컬 검증에서만 text로 바꿔 넘긴다.
# 이 치환 때문에 "embedding 컬럼 타입"만은 여기서 검증되지 않는다.
strip_pgvector() {
  sed -e '/create extension if not exists vector/d' \
      -e 's/extensions\.vector(768)/text/g' "$1"
}

echo "==> 마이그레이션 적용  (pgvector 없음 -> embedding 컬럼은 text로 치환)"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "    $(basename "$f")"
  strip_pgvector "$f" | psql_run -f -
done

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

echo "==> 검증"
psql_run -f "$ROOT/supabase/test/03_assert.sql"

echo
echo "완료."

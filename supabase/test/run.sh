#!/usr/bin/env bash
# 마이그레이션 검증 + 크레딧 동시성 테스트.
#
#   bash supabase/test/run.sh
#
# Docker만 있으면 된다. 일회용 Postgres를 띄워 마이그레이션을 그대로 적용하고,
# 잔액 5인 계정에 동시 차감 요청 20건을 던져 정확히 5건만 통과하는지 확인한다.
set -euo pipefail

CONTAINER=msm-pgtest
IMAGE=pgvector/pgvector:pg16
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo "==> Postgres 기동"
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done

psql_file() {
  docker cp "$1" "$CONTAINER:/tmp/x.sql" >/dev/null
  docker exec "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f /tmp/x.sql
}

echo "==> Supabase 객체 스텁"
psql_file "$ROOT/supabase/test/00_bootstrap.sql"

echo "==> 마이그레이션 적용"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "    $(basename "$f")"
  psql_file "$f"
done

echo "==> 시드 (잔액 5 만들기)"
psql_file "$ROOT/supabase/test/01_seed.sql"

echo "==> 동시 차감 20건 (클라이언트 20, 각 1회)"
docker cp "$ROOT/supabase/test/02_spend.bench.sql" "$CONTAINER:/tmp/spend.sql" >/dev/null
# 잔액 소진 후 요청은 45001로 실패하는 게 정상이라 pgbench 종료 코드는 무시한다.
docker exec "$CONTAINER" pgbench -U postgres -d postgres \
  -c 20 -j 4 -t 1 -n -f /tmp/spend.sql 2>&1 | grep -E 'transactions|failed|latency' || true

echo "==> 검증"
psql_file "$ROOT/supabase/test/03_assert.sql"

echo
echo "완료."

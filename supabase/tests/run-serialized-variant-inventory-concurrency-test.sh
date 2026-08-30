#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
container="baci-serialized-inventory-${RANDOM}-$$"
postgres_password="test"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT

wait_for_postgres() {
  for _ in $(seq 1 30); do
    logs="$(docker logs "$container" 2>&1 || true)"
    if grep -Fq 'PostgreSQL init process complete; ready for start up.' <<<"$logs" &&
      docker exec -e PGPASSWORD="$postgres_password" "$container" \
        psql -X -qAt -U postgres -h 127.0.0.1 \
        -c 'SELECT 1' >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  docker logs "$container" >&2 || true
  return 1
}

docker run --name "$container" -e POSTGRES_PASSWORD="$postgres_password" \
  -d postgres:17-alpine >/dev/null
wait_for_postgres

docker exec -e PGPASSWORD="$postgres_password" -i "$container" \
  psql -X -v ON_ERROR_STOP=1 -U postgres -h 127.0.0.1 \
  < "$repo_root/supabase/tests/serialized_variant_inventory_concurrency_fixture.sql"

node "$repo_root/supabase/tests/serialized_variant_inventory_concurrency_fixture_functions.mjs" "$repo_root" |
  docker exec -e PGPASSWORD="$postgres_password" -i "$container" \
    psql -X -v ON_ERROR_STOP=1 -U postgres -h 127.0.0.1

docker exec -e PGPASSWORD="$postgres_password" -i "$container" \
  psql -X -v ON_ERROR_STOP=1 -U postgres -h 127.0.0.1 \
  < "$repo_root/supabase/migrations/20260829002000_harden_serialized_inventory_release_ordering.sql"

docker exec -e PGPASSWORD="$postgres_password" -i "$container" \
  psql -X -v ON_ERROR_STOP=1 -U postgres -h 127.0.0.1 \
  -v DATABASE_URL="postgresql://postgres:${postgres_password}@127.0.0.1:5432/postgres" \
  < "$repo_root/supabase/tests/serialized_variant_inventory_concurrency_fixture_assertions.sql"

docker exec -e PGPASSWORD="$postgres_password" -i "$container" \
  psql -X -v ON_ERROR_STOP=1 -U postgres -h 127.0.0.1 \
  -v DATABASE_URL="postgresql://postgres:${postgres_password}@127.0.0.1:5432/postgres" \
  < "$repo_root/supabase/tests/serialized_variant_inventory_concurrency_fixture_partial_confirmation_assertions.sql"

echo 'Serialized variant-inventory concurrency PostgreSQL test passed'

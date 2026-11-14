#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTAINER_NAME="baci-blog-release-reservations-test-$$"

cleanup() {
  docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run -d --name "${CONTAINER_NAME}" \
  --network none \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  -e POSTGRES_DB=postgres \
  postgres:18-alpine \
  -c listen_addresses= >/dev/null

is_postgres_final_server_ready() {
  local logs
  logs="$(docker logs "${CONTAINER_NAME}" 2>&1 || true)"
  [[ "${logs}" == *"PostgreSQL init process complete; ready for start up."* ]] \
    && docker exec "${CONTAINER_NAME}" pg_isready -U postgres -d postgres >/dev/null 2>&1
}

for _ in $(seq 1 30); do
  if is_postgres_final_server_ready; then
    break
  fi
  sleep 0.5
done

is_postgres_final_server_ready

run_psql_file() {
  local file_path="$1"
  echo "Running $(basename "${file_path}")..."
  docker exec -i "${CONTAINER_NAME}" \
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < "${file_path}"
}

run_psql_file "${ROOT_DIR}/supabase/tests/blog_article_identity_and_release_reservations_fixture.sql"
run_psql_file "${ROOT_DIR}/supabase/migrations/20261114104500_blog_article_identity_and_release_reservations.sql"
run_psql_file "${ROOT_DIR}/supabase/tests/blog_article_identity_and_release_reservations.sql"
run_psql_file "${ROOT_DIR}/supabase/tests/blog_article_identity_and_release_reservations_concurrency.sql"

echo "All blog article identity and release reservation SQL tests passed."

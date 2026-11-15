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

for migration in \
  "${ROOT_DIR}"/supabase/migrations/202611141045*.sql \
  "${ROOT_DIR}"/supabase/migrations/202611151155*.sql; do
  run_psql_file "${migration}"
done

docker cp "${ROOT_DIR}/supabase/tests" "${CONTAINER_NAME}:/tmp/tests"

for test_file in \
  blog_release_identity_and_permissions.sql \
  blog_release_reserve_and_caps.sql \
  blog_release_caps_reschedule_and_recovery.sql \
  blog_release_spacing_and_recovery.sql \
  blog_release_finalizer_triggers.sql \
  blog_release_reschedule_policy_and_guards.sql \
  blog_release_concurrency.sql; do
  echo "Running ${test_file}..."
  docker exec "${CONTAINER_NAME}" \
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f "/tmp/tests/${test_file}"
done

echo "All blog article identity and release reservation SQL tests passed."

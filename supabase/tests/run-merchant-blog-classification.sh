#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
container="baci-merchant-classification-test-$$"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run --detach --name "$container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust postgres:18-alpine -c listen_addresses= >/dev/null
ready=false
for attempt in {1..30}; do
  logs="$(docker logs --tail 100 "$container" 2>&1 || true)"
  init_complete=false
  if [[ "$logs" == *'PostgreSQL init process complete; ready for start up.'* ]]; then
    init_complete=true
  fi

  server_ready=false
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then
    server_ready=true
  fi

  if [[ "$init_complete" == true && "$server_ready" == true ]]; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  printf 'PostgreSQL did not become ready after initialization within 30 attempts\n' >&2
  exit 1
fi
run_sql() { docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres < "$1"; }
run_sql "$root/supabase/tests/merchant_blog_classification_fixture.sql"
run_sql "$root/supabase/migrations/20260823163000_optimize_storefront_cluster_guide_classifier_ordered_core.sql"
run_sql "$root/supabase/migrations/20260823163001_optimize_storefront_cluster_guide_classifier_ordered_rpc.sql"
for migration in "$root"/supabase/migrations/*_merchant_blog_classification_*.sql; do
  if [[ "${1:-}" == '--before-guides' && "$migration" == *_merchant_blog_classification_guides.sql ]]; then continue; fi
  if [[ "${1:-}" == '--before-snapshot' && "$migration" == *_merchant_blog_classification_snapshot.sql ]]; then continue; fi
  if [[ "${1:-}" == '--before-snapshot' && "$migration" == *_merchant_blog_classification_revision.sql ]]; then continue; fi
  if [[ "${1:-}" == '--before-private-boundary' && "$migration" == *_merchant_blog_classification_private_boundary.sql ]]; then continue; fi
  run_sql "$migration"
done
run_sql "$root/supabase/tests/merchant_blog_classification_security.sql"
run_sql "$root/supabase/tests/merchant_blog_classification_lifecycle.sql"
run_sql "$root/supabase/tests/merchant_blog_classification_guides.sql"
run_sql "$root/supabase/tests/merchant_blog_classification_snapshot.sql"
run_sql "$root/supabase/tests/merchant_blog_classification_revision.sql"
run_sql "$root/supabase/tests/merchant_blog_classification_private_boundary.sql"
run_sql "$root/supabase/tests/merchant_blog_classification_schema_contract.sql"

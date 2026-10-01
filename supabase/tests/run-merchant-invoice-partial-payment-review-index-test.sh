#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
container="baci-merchant-invoice-review-index-${RANDOM}-$$"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT

wait_for_postgres_final_readiness() {
  for _ in $(seq 1 30); do
    logs="$(docker logs "$container" 2>&1 || true)"
    if grep -Fq 'PostgreSQL init process complete; ready for start up.' <<<"$logs" &&
      docker exec "$container" psql -X -qAt -U postgres -h 127.0.0.1 \
        -c 'SELECT 1' >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  docker logs "$container" >&2 || true
  return 1
}

docker run --name "$container" -e POSTGRES_PASSWORD=test -d postgres:17-alpine >/dev/null
if ! wait_for_postgres_final_readiness; then
  echo 'PostgreSQL did not reach final readiness' >&2
  exit 1
fi

docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -h 127.0.0.1 \
  < "$repo_root/supabase/tests/merchant_invoice_partial_payment_review_index_fixture.sql"
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -h 127.0.0.1 \
  < "$repo_root/supabase/migrations/20260805090000_complete_merchant_invoice_partial_payments.sql"
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -h 127.0.0.1 \
  < "$repo_root/supabase/tests/merchant_invoice_partial_payment_review_index.sql"

echo 'Merchant invoice partial-payment review index PostgreSQL test passed'

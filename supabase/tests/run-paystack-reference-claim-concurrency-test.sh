#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
container="baci-paystack-reference-claim-${RANDOM}-$$"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT

wait_for_postgres() {
  for _ in $(seq 1 30); do
    if docker exec "$container" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  docker logs "$container" >&2 || true
  return 1
}

docker run --name "$container" -e POSTGRES_PASSWORD=test \
  -d postgres:17-alpine >/dev/null
wait_for_postgres

psql() {
  docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -h 127.0.0.1 "$@"
}

psql < "$repo_root/supabase/tests/paystack_reference_claim_concurrency_fixture.sql"
psql < "$repo_root/supabase/migrations/20260702044949_serialize_order_payment_writes.sql"
psql < "$repo_root/supabase/migrations/20260811100000_manual_paystack_partial_reconciliation.sql"
psql < "$repo_root/supabase/migrations/20260811120000_allow_reviewed_paystack_email_mismatch.sql"
psql < "$repo_root/supabase/migrations/20260811140000_harden_paystack_manual_reconciliation_review_contracts.sql"
psql < "$repo_root/supabase/migrations/20260811150000_idempotent_paystack_reconciliation_retries.sql"
psql < "$repo_root/supabase/migrations/20260811170000_require_paystack_reconciliation_operator_access.sql"
psql < "$repo_root/supabase/migrations/20260811180000_fix_paystack_reconciliation_retry_balance.sql"
psql -v DATABASE_URL='postgresql://postgres:test@127.0.0.1:5432/postgres' \
  < "$repo_root/supabase/migrations/tests/paystack_reference_claim_concurrency.sql"

echo 'Paystack reference-claim concurrency PostgreSQL test passed'

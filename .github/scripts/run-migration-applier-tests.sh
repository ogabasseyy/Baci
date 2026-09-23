#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"

cd "$repo_root"

bash "$script_dir/apply-pending-migrations.test.sh"
node --test "$script_dir/repair-sales-migration-collision.test.mjs"
node --test "$script_dir/repair-sales-migration-collision.sql.test.mjs"
bash "$script_dir/deferred-production-migrations.test.sh"
bash "$script_dir/apply-pending-migrations-version-collision.test.sh"
bash "$script_dir/historical-migration-repair-spec.test.sh"
bash "$script_dir/historical-migration-repair-backfill.test.sh"
bash "$repo_root/supabase/tests/run-storefront-order-private-schema-boundary-test.sh"
bash "$repo_root/supabase/tests/run-paystack-reference-claim-concurrency-test.sh"
bash "$repo_root/supabase/tests/run-merchant-invoice-partial-payment-review-index-test.sh"
bash "$repo_root/supabase/tests/run-gigl-tracking-retry-repair-test.sh"
bash "$repo_root/supabase/tests/run-gigl-monitor-backfill-repair-test-runner.test.sh"
bash "$repo_root/supabase/tests/run-gigl-monitor-backfill-repair-test.sh"
node --test "$script_dir/split-sql-statements.test.mjs"

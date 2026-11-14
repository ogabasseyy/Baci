#!/usr/bin/env bash
# Disposable synthetic cluster only; never accepts a connection URL.
set -euo pipefail
fixture_dir=$(mktemp -d /tmp/oxygen-financial-fence-XXXXXX)
cleanup() { pg_ctl -D "$fixture_dir" -m fast stop >/dev/null 2>&1 || true; rm -rf "$fixture_dir"; }
trap cleanup EXIT
initdb -D "$fixture_dir" -A trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$fixture_dir" -l "$fixture_dir/server.log" -o "-k $fixture_dir -p 55478 -c listen_addresses=''" start >/dev/null
export PGHOST="$fixture_dir" PGPORT=55478 PGDATABASE=postgres
createdb oxygen_financial_fence_test
export PGDATABASE=oxygen_financial_fence_test
psql -Xq -v ON_ERROR_STOP=1 -f supabase/tests/oxygen_financial_edit_concurrency_fixture.sql
psql -Xq -v ON_ERROR_STOP=1 -f supabase/migrations/20261103010000_oxygen_safe_payment_method_exit.sql
psql -Xq -v ON_ERROR_STOP=1 -c 'CREATE TRIGGER oxygen_order_payment_method_fence BEFORE UPDATE OF payment_method ON public.orders FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_order_payment_method()'
psql -Xq -v ON_ERROR_STOP=1 -f supabase/migrations/20261103024423_oxygen_order_financial_edit_fence.sql
psql -Xq -v ON_ERROR_STOP=1 -f supabase/migrations/20261103030902_oxygen_safe_financial_fence_payment_exit.sql
export OXYGEN_FINANCIAL_FENCE_TEST_DB="$PGDATABASE"
export OXYGEN_FINANCIAL_FENCE_TEST_SOCKET="$fixture_dir"
export OXYGEN_FINANCIAL_FENCE_TEST_PORT="$PGPORT"
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm --filter @baci/web exec vitest run tools/db/oxygen-financial-edit-concurrency.test.ts --maxWorkers=1

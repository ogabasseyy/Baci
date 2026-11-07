#!/usr/bin/env bash
# Minimal isolated PostgreSQL fixture; never connects to the configured database.
set -euo pipefail
for executable in initdb pg_ctl psql; do
  command -v "$executable" >/dev/null || { echo "Missing $executable" >&2; exit 1; }
done
task_repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
task_pg_dir=$(mktemp -d /tmp/baci-customer-spending-tests.XXXXXX)
task_pg_started=false
cleanup() {
  if [ "$task_pg_started" = true ]; then pg_ctl -D "$task_pg_dir" -m fast stop >/dev/null; fi
  case "$task_pg_dir" in /tmp/baci-customer-spending-tests.*)
    if [ -f "$task_pg_dir/PG_VERSION" ]; then rm -rf -- "$task_pg_dir"; fi ;;
  esac
}
trap cleanup EXIT
initdb -D "$task_pg_dir" --auth=trust --no-locale >/dev/null
pg_ctl -D "$task_pg_dir" -l "$task_pg_dir/server.log" -o "-h '' -k $task_pg_dir -p 55497" start >/dev/null
task_pg_started=true
psql -X -h "$task_pg_dir" -p 55497 -d postgres -v ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA private;
CREATE TABLE public.receipt_claims (id uuid);
CREATE TABLE public.customers (id uuid PRIMARY KEY, total_orders integer, total_spent numeric, updated_at timestamptz);
CREATE TABLE public.orders (id uuid PRIMARY KEY, customer_id uuid, total numeric, payment_status text, shipping_status text);
SQL
psql -X -h "$task_pg_dir" -p 55497 -d postgres -v ON_ERROR_STOP=1 \
  -f "$task_repo/supabase/migrations/20261107091221_customer_spending_exclude_cancelled.sql" \
  -c 'CREATE TRIGGER update_customer_stats_trigger AFTER INSERT OR UPDATE OR DELETE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.fn_update_customer_stats()' \
  -f "$task_repo/supabase/tests/customer_spending_cancelled_orders.sql"
echo 'Customer spending SQL regression checks passed.'

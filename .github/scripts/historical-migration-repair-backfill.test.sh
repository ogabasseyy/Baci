#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fixture_root="$(mktemp -d)"
trap 'rm -rf "$fixture_root"' EXIT

expected_repair=$'20260804000500\trepair_gigl_monitor_backfill_join\t605a0d48a4f116e67ee626ff173b66c6c80cefa77ad606a3813aa1ea6deda62a'
. "$script_dir/historical-migration-repair-spec.sh"
[ "$(historical_migration_repair_spec 20260801142200 cleanup_unowned_gigl_monitor_backfill)" = "$expected_repair" ]

fake_bin="$fixture_root/bin"
migrations_dir="$fixture_root/migrations"
mkdir -p "$fake_bin" "$migrations_dir"

cp "$script_dir/apply-pending-migrations.sh" "$fixture_root/"
cp "$script_dir/apply-pending-migration.sh" "$fixture_root/"
cp "$script_dir/repair-sales-migration-collision.sh" "$fixture_root/"
cp "$script_dir/apply-atomic-migration-group.sh" "$fixture_root/"
cp "$script_dir/deferred-production-migrations.sh" "$fixture_root/"
cp "$script_dir/historical-migration-repair-handler.sh" "$fixture_root/"
cp "$script_dir/historical-migration-repair-spec.sh" "$fixture_root/"
cp "$script_dir/build-historical-repair-payload.sh" "$fixture_root/"
cp "$script_dir/check-migration-versions.sh" "$fixture_root/"
cp "$script_dir/../../supabase/migrations/20260801142200_cleanup_unowned_gigl_monitor_backfill.sql" \
  "$migrations_dir/20260801142200_cleanup_unowned_gigl_monitor_backfill.sql"
cp "$script_dir/../../supabase/migrations/20260804000500_repair_gigl_monitor_backfill_join.sql" \
  "$migrations_dir/20260804000500_repair_gigl_monitor_backfill_join.sql"

cat >"$fake_bin/curl" <<'FAKE_CURL'
#!/usr/bin/env bash

set -euo pipefail

data_binary=''
while (($#)); do
  case "$1" in
    --data-binary)
      data_binary="${2:-}"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

[ "$data_binary" = '@-' ]
payload="$(cat)"
printf '%s\n' "$payload" >>"$FAKE_QUERY_LOG"
if jq -e '.query | startswith("SELECT version, name")' >/dev/null <<<"$payload"; then
  printf '[]\n'
else
  printf '[]\n'
fi
FAKE_CURL
chmod +x "$fake_bin/curl"

output="$fixture_root/output.log"
query_log="$fixture_root/queries.log"
PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$migrations_dir" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$query_log" \
  bash "$fixture_root/apply-pending-migrations.sh" >"$output"

grep -q \
  'reconciled by append-only repair migration 20260804000500_repair_gigl_monitor_backfill_join.sql' \
  "$output"
grep -q 'applied:         20260804000500  repair_gigl_monitor_backfill_join' "$output"
grep -q 'Migrations summary: 1 applied, 1 skipped.' "$output"
grep -q 'FROM public.shipments AS shipment,' "$query_log"
grep -q 'order_row.id = monitor.order_id' "$query_log"
if grep -q 'JOIN public.orders AS order_row ON order_row.id = monitor.order_id' "$query_log"; then
  echo 'The malformed historical monitor cleanup must not be sent to Supabase' >&2
  exit 1
fi

echo 'GIGL monitor backfill repair applier test passed'

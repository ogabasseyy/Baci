#!/usr/bin/env bash
#
# Apply pending Supabase migrations to production via the Management API.
#
# Avoids `supabase db push`, which requires a database password. We only need:
#   - SUPABASE_ACCESS_TOKEN — personal/org access token (sbp_…)
#   - SUPABASE_PROJECT_REF  — project ref (e.g. aivqthbxdshhltbwipbr)
#
# For each .sql file in supabase/migrations/ in filename order, the script:
#   1. Extracts the version (timestamp prefix) and name from the filename.
#   2. Skips the file if the version+recorded name is already reconciled in
#      supabase_migrations.schema_migrations. Two known historical collisions
#      are accepted only when their later repair migration is present.
#   3. Otherwise sends a single Management API request that runs the
#      migration SQL AND registers a row in schema_migrations. Normal migrations
#      are wrapped in one explicit BEGIN/COMMIT transaction, so the SQL and its
#      history row are atomic: if any statement errors (e.g. a hot-table ALTER
#      that times out on its lock) the whole block rolls back and NO history row
#      is written, so the next deploy retries instead of skipping a migration
#      that was recorded but never applied. The response is also validated (a
#      non-array body = error) so a 200-with-error never counts as success.
#      Files that start with `-- disable-transaction` are intentionally split
#      into top-level statements first so operations like CREATE INDEX
#      CONCURRENTLY can run outside a transaction; their history row is written
#      only after every statement succeeds.
#
# MIGRATION_PHASE=predeploy leaves the explicit postdeploy-only enforcement
# list unapplied so the old application revision keeps working while the new
# claim-minting revision is rolled out. MIGRATION_PHASE=postdeploy (or the
# default `all`) applies those migrations normally.
#
# `statements` remains ARRAY[]::text[] because the CLI only consults version/name;
# preserving SQL there would require fragile escaping of `$$` and single quotes.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
migrations_dir="${MIGRATIONS_DIR:-$(cd "$script_dir/../.." && pwd)/supabase/migrations}"
if [ ! -d "$migrations_dir" ]; then
  echo "::error::supabase/migrations directory not found at $migrations_dir"
  exit 1
fi

if ! . "$script_dir/deferred-production-migrations.sh"; then
  echo "::error::deferred production migration policy could not be loaded" >&2
  exit 1
fi

migration_phase="${MIGRATION_PHASE:-all}"
case "$migration_phase" in
  all|predeploy|postdeploy)
    ;;
  *)
    echo "::error::MIGRATION_PHASE must be all, predeploy, or postdeploy" >&2
    exit 1
    ;;
esac

if ! . "$script_dir/historical-migration-repair-handler.sh"; then
  echo "::error::historical migration repair handler could not be loaded" >&2
  exit 1
fi
if ! load_historical_migration_repair_handler "$script_dir"; then
  exit 1
fi

bash "$script_dir/check-migration-versions.sh" "$migrations_dir"

: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is required}"
: "${SUPABASE_PROJECT_REF:?SUPABASE_PROJECT_REF is required}"

readonly API="https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query"
readonly AUTH_HEADER="Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}"

api_query() {
  curl --fail-with-body --silent --show-error \
    -X POST \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    --data-binary @- \
    "$API"
}

api_query_payload() {
  local body="$1" response
  # Capture response for SQL errors; curl --fail-with-body preserves HTTP bodies.
  # The Management API can also report a failed statement with a 200 status and
  # an error object in the body. /database/query returns arrays on success and
  # objects on error, so treat anything that is not an array as a failure. Without
  # this, a migration whose SQL errors could still have its schema_migrations row
  # written and then be skipped on every future deploy (recorded-but-not-applied
  # drift).
  if ! response="$(api_query <<<"$body")" || \
    ! jq -e 'type == "array"' >/dev/null 2>&1 <<<"$response"; then
    echo "::error::Supabase query did not succeed; aborting before recording the migration." >&2
    printf 'Response: %s\n' "$response" | head -c 2000 >&2
    return 1
  fi
}

split_sql_statements() {
  node "$script_dir/split-sql-statements.mjs" "$1"
}

build_register_migration_query() {
  jq -nr \
    --arg version "$1" \
    --arg name "$2" \
    '"INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES ("
     + "'"'"'" + ($version | gsub("'"'"'"; "'"'"''"'"'")) + "'"'"', "
     + "'"'"'" + ($name | gsub("'"'"'"; "'"'"''"'"'")) + "'"'"', "
     + "ARRAY[]::text[]);"'
}

. "$script_dir/apply-atomic-migration-group.sh"
. "$script_dir/apply-pending-migration.sh"
. "$script_dir/repair-sales-migration-collision.sh"

applied_versions_body="$(jq -n '{query: "SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version"}')"
applied_versions_response="$(api_query <<<"$applied_versions_body")"
applied_migrations="$(jq -r '.[] | [.version, .name] | @tsv' <<<"$applied_versions_response")"

applied_count_remote=$(printf '%s' "$applied_migrations" | grep -c . || true)
echo "Applied versions on remote: ${applied_count_remote}"

shopt -s nullglob
files=("$migrations_dir"/*.sql)
shopt -u nullglob

if [ "${#files[@]}" -eq 0 ]; then
  echo "No migration files on disk — nothing to apply."
  exit 0
fi

# Bash expands globs in lexical order, which is the migration timestamp order.
# Avoid mapfile so the deployment preflight is also testable with macOS Bash.
sorted_files=("${files[@]}")

applied_count=0
skipped_count=0
deferred_count=0
atomic_group_skip_bases=''

for file in "${sorted_files[@]}"; do
  base="$(basename "$file" .sql)"
  version="${base%%_*}"
  name="${base#*_}"

  if [ -n "$atomic_group_skip_bases" ] && \
    printf '%s\n' "$atomic_group_skip_bases" | grep -Fqx -- "$base"; then
    continue
  fi

  recorded_name="$(awk -F '\t' -v version="$version" '$1 == version { print $2; exit }' <<<"$applied_migrations")"
  # This byte-identical wallet migration was renamed after it had shipped.
  # Treat the original ledger entry as its authority, without replaying old
  # function definitions or inserting a fabricated new history row.
  if [ "$base" = '20260903120500_guard_merchant_wallet_paystack_dva_alias' ] && \
    [ -z "$recorded_name" ] && \
    [ "$(awk -F '\t' '$1 == "20260903120000" { print $2; exit }' <<<"$applied_migrations")" = guard_merchant_wallet_paystack_dva_alias ]; then
    echo "✓ already applied under 20260903120000: $base"
    skipped_count=$((skipped_count + 1))
    continue
  fi
  if [ -n "$recorded_name" ]; then
    if [ "$version:$recorded_name:$name" = '20260903120000:guard_merchant_wallet_paystack_dva_alias:exclude_repair_pickup_from_merchant_sales' ]; then
      repair_sales_migration_collision || exit 1
    elif historical_collision_version_is_known "$version"; then
      if ! historical_collision_name_is_valid "$version" "$recorded_name" || \
        ! historical_collision_name_is_valid "$version" "$name"; then
        echo "::error::Historical collision $version has an unexpected recorded/current name pair: $recorded_name / $name" >&2
        exit 1
      fi

      if ! repair_spec="$(historical_collision_repair_spec "$version" "$recorded_name")"; then
        echo "::error::Historical collision $version recorded '$recorded_name', whose missing sibling has no repair migration" >&2
        exit 1
      fi
      IFS=$'\t' read -r repair_version repair_name <<<"$repair_spec"

      repair_recorded_name="$(awk -F '\t' -v version="$repair_version" '$1 == version { print $2; exit }' <<<"$applied_migrations")"
      if [ -n "$repair_recorded_name" ]; then
        if [ "$repair_recorded_name" != "$repair_name" ]; then
          echo "::error::Repair migration $repair_version is recorded as '$repair_recorded_name', not '$repair_name'" >&2
          exit 1
        fi
      elif [ ! -f "$migrations_dir/${repair_version}_${repair_name}.sql" ]; then
        echo "::error::Historical collision $version requires repair migration ${repair_version}_${repair_name}.sql" >&2
        exit 1
      fi
      echo "::warning::Historical collision $version is reconciled by repair migration ${repair_version}_${repair_name}.sql (recorded name: $recorded_name)"
    elif [ "$recorded_name" != "$name" ]; then
      if historical_name_alias_is_valid "$version" "$recorded_name" "$name"; then
        echo "::warning::historical name alias $version is reconciled: $recorded_name -> $name"
      else
        echo "::error::Migration $version is recorded as '$recorded_name', not current file '$name'" >&2
        exit 1
      fi
    fi
    echo "✓ already applied: $version  ${name}"
    skipped_count=$((skipped_count + 1))
    continue
  fi

  if [ "$migration_phase" = "predeploy" ] && is_postdeploy_migration "$base"; then
    echo "⏸ deferred until postdeploy: $version  ${name}"
    deferred_count=$((deferred_count + 1))
    continue
  fi

  atomic_group_files=()
  atomic_group_cursor="$base"
  atomic_group_candidate_skip_bases=''
  while next_base="$(atomic_migration_group_next_base "$atomic_group_cursor")"; do
    next_file="$migrations_dir/${next_base}.sql"
    if [ ! -f "$next_file" ] || \
      [ -n "$(awk -F '\t' -v version="${next_base%%_*}" '$1 == version { print $2; exit }' <<<"$applied_migrations")" ]; then
      atomic_group_files=()
      atomic_group_candidate_skip_bases=''
      break
    fi
    atomic_group_files+=("$next_file")
    atomic_group_candidate_skip_bases="${atomic_group_candidate_skip_bases}${atomic_group_candidate_skip_bases:+$'\n'}${next_base}"
    atomic_group_cursor="$next_base"
  done
  if [ "${#atomic_group_files[@]}" -gt 0 ]; then
    apply_atomic_migration_group "$file" "${atomic_group_files[@]}" || exit 1
    atomic_group_skip_bases="$atomic_group_candidate_skip_bases"
    continue
  fi

  if supersession_spec="$(historical_migration_repair_supersession_spec "$version" "$name")"; then
    if ! skip_superseded_historical_migration_repair "$version" "$name" "$supersession_spec"; then
      exit 1
    fi
    continue
  fi

  if repair_spec="$(historical_migration_repair_spec "$version" "$name")"; then
    if ! apply_historical_migration_repair "$version" "$name" "$file" "$repair_spec"; then
      exit 1
    fi
    continue
  fi

  apply_pending_migration "$file" "$version" "$name" || exit 1
done

echo
if [ "$deferred_count" -gt 0 ]; then
  echo "Migrations summary: ${applied_count} applied, ${skipped_count} skipped, ${deferred_count} deferred."
else
  echo "Migrations summary: ${applied_count} applied, ${skipped_count} skipped."
fi

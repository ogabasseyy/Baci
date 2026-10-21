#!/usr/bin/env bash

# This file is sourced by apply-pending-migrations.sh after its query helpers
# are defined. It intentionally updates the caller's migration counters only
# after the Management API transaction has succeeded.
load_historical_migration_repair_handler() {
  local handler_dir="$1"
  local repair_spec_file="$handler_dir/historical-migration-repair-spec.sh"

  if [ ! -r "$repair_spec_file" ]; then
    echo "::error::historical repair specification not found at $repair_spec_file" >&2
    return 1
  fi
  . "$repair_spec_file"
  if ! declare -F historical_migration_repair_spec >/dev/null; then
    echo "::error::historical_migration_repair_spec not defined by $repair_spec_file" >&2
    return 1
  fi
  if ! declare -F historical_migration_repair_supersession_spec >/dev/null; then
    echo "::error::historical_migration_repair_supersession_spec not defined by $repair_spec_file" >&2
    return 1
  fi
  if ! declare -F historical_migration_version_alias_spec >/dev/null; then
    echo "::error::historical_migration_version_alias_spec not defined by $repair_spec_file" >&2
    return 1
  fi
}

verify_historical_migration_version_alias() {
  local file="$1" alias_spec="$2"
  local alias_version alias_name expected_stored_sha expected_file_sha recorded_name recorded_sha actual_sha base version name

  IFS=$'\t' read -r alias_version alias_name expected_stored_sha expected_file_sha <<<"$alias_spec"
  base="$(basename "$file" .sql)"
  version="${base%%_*}"
  name="${base#*_}"
  recorded_name="$(awk -F '\t' -v version="$alias_version" '$1 == version { print $2; exit }' <<<"$applied_migrations")"
  if ! historical_migration_version_is_recorded "$alias_version"; then
    return 1
  fi

  recorded_sha="$(awk -F '\t' -v version="$alias_version" '$1 == version { print $3; exit }' <<<"$applied_migrations")"
  actual_sha="$(sha256sum "$file" | awk '{print $1}')"
  if [ "$recorded_name" != "$alias_name" ] || [ "$recorded_sha" != "$expected_stored_sha" ] || [ "$actual_sha" != "$expected_file_sha" ]; then
    echo "::error::Historical migration alias for $version $name failed exact-name or SQL checksum verification (recorded $alias_version: $recorded_name, stored SHA ${recorded_sha:-missing}, file SHA $actual_sha)" >&2
    return 2
  fi
  return 0
}

historical_migration_version_is_recorded() {
  local version="$1"
  awk -F '\t' -v version="$version" '$1 == version { found = 1; exit } END { exit !found }' <<<"$applied_migrations"
}

load_historical_migration_version_alias_history() {
  local alias_version_sql='' file base version name alias_spec alias_version
  local applied_versions_query applied_versions_body applied_versions_response

  for file in "$@"; do
    base="$(basename "$file" .sql)"
    version="${base%%_*}"
    name="${base#*_}"
    if alias_spec="$(historical_migration_version_alias_spec "$version" "$name")"; then
      IFS=$'\t' read -r alias_version _ <<<"$alias_spec"
      if ! [[ "$alias_version" =~ ^[0-9]{14}$ ]]; then
        echo "::error::Historical migration alias for $version $name has an invalid recorded version" >&2
        return 1
      fi
      alias_version_sql="${alias_version_sql}${alias_version_sql:+, }'${alias_version}'"
    fi
  done
  [ -n "$alias_version_sql" ] || alias_version_sql="''"

  applied_versions_query="SELECT version, name, CASE WHEN version IN (${alias_version_sql}) THEN encode(sha256(convert_to(array_to_json(statements)::text, 'UTF8')), 'hex') END AS statements_sha256 FROM supabase_migrations.schema_migrations ORDER BY version"
  applied_versions_body="$(jq -n --arg query "$applied_versions_query" '{query: $query}')"
  applied_versions_response="$(api_query <<<"$applied_versions_body")" || return 1
  applied_migrations="$(jq -r '.[] | [.version, .name, (.statements_sha256 // "")] | @tsv' <<<"$applied_versions_response")" || return 1
}

preflight_historical_migration_version_aliases() {
  local file base version name alias_spec alias_version

  for file in "$@"; do
    base="$(basename "$file" .sql)"
    version="${base%%_*}"
    name="${base#*_}"
    if ! alias_spec="$(historical_migration_version_alias_spec "$version" "$name")"; then
      continue
    fi
    if [ "$migration_phase" = "predeploy" ] && is_postdeploy_migration "$base"; then
      continue
    fi
    if [ -n "$migration_max_version" ] && LC_ALL=C [ "$version" \> "$migration_max_version" ]; then
      continue
    fi
    IFS=$'\t' read -r alias_version _ <<<"$alias_spec"
    if historical_migration_version_is_recorded "$alias_version"; then
      verify_historical_migration_version_alias "$file" "$alias_spec" || return $?
    fi
  done
}

handle_historical_migration_version_alias() {
  local version="$1" name="$2" base="$3" file="$4" alias_spec="$5"
  local alias_version

  if [ "$migration_phase" = "predeploy" ] && is_postdeploy_migration "$base"; then
    echo "⏸ deferred until postdeploy: $version  ${name}"
    deferred_count=$((deferred_count + 1))
    return 0
  fi
  if [ -n "$migration_max_version" ] && LC_ALL=C [ "$version" \> "$migration_max_version" ]; then
    echo "⏸ deferred above MIGRATION_MAX_VERSION $migration_max_version: $version  ${name}"
    deferred_count=$((deferred_count + 1))
    return 0
  fi

  IFS=$'\t' read -r alias_version _ <<<"$alias_spec"
  historical_migration_version_is_recorded "$alias_version" || return 1
  verify_historical_migration_version_alias "$file" "$alias_spec" || return $?
  echo "✓ already applied under version $alias_version: $version  ${name}"
  skipped_count=$((skipped_count + 1))
}

apply_historical_migration_repair() {
  local version="$1"
  local name="$2"
  local file="$3"
  local repair_spec="$4"
  local repair_version repair_name expected_sha repair_file actual_sha body

  IFS=$'\t' read -r repair_version repair_name expected_sha <<<"$repair_spec"
  repair_file="$migrations_dir/${repair_version}_${repair_name}.sql"
  actual_sha="$(sha256sum "$file" | awk '{print $1}')"
  if [ -z "$repair_version" ] || [ -z "$repair_name" ] || [ -z "$expected_sha" ] || \
    [ "$actual_sha" != "$expected_sha" ] || [ ! -f "$repair_file" ]; then
    echo "::error::Historical migration $version requires the pinned append-only repair ${repair_version}_${repair_name}.sql and original source checksum" >&2
    return 1
  fi
  body="$(bash "$script_dir/build-historical-repair-payload.sh" "$repair_file" "$(build_register_migration_query "$version" "$name")" "$(build_register_migration_query "$repair_version" "$repair_name")")"
  api_query_payload "$body" || return 1
  echo "✓ applied:         $repair_version  $repair_name"
  echo "::warning::Historical migration $version is reconciled by append-only repair migration ${repair_version}_${repair_name}.sql"
  applied_migrations="${applied_migrations}${applied_migrations:+$'\n'}${version}"$'\t'"${name}"$'\n'"${repair_version}"$'\t'"${repair_name}"
  applied_count=$((applied_count + 1))
}

skip_superseded_historical_migration_repair() {
  local version="$1"
  local name="$2"
  local supersession_spec="$3"
  local original_version original_name replacement_version replacement_name
  local original_recorded_name replacement_recorded_name replacement_file

  IFS=$'\t' read -r original_version original_name replacement_version replacement_name <<<"$supersession_spec"
  original_recorded_name="$(awk -F '\t' -v version="$original_version" '$1 == version { print $2; exit }' <<<"$applied_migrations")"
  replacement_recorded_name="$(awk -F '\t' -v version="$replacement_version" '$1 == version { print $2; exit }' <<<"$applied_migrations")"
  if [ -z "$original_version" ] || [ -z "$original_name" ] || [ -z "$replacement_version" ] || [ -z "$replacement_name" ] || \
    [ "$original_recorded_name" != "$original_name" ] || \
    { [ -n "$replacement_recorded_name" ] && [ "$replacement_recorded_name" != "$replacement_name" ]; }; then
    echo "::error::Superseded repair $version requires reconciled historical migration ${original_version}_${original_name}.sql and replacement ${replacement_version}_${replacement_name}.sql" >&2
    return 1
  fi
  if [ -n "$replacement_recorded_name" ]; then
    echo "::warning::Superseded append-only repair $version is skipped after ${replacement_version}_${replacement_name}.sql reconciled $original_version"
  else
    replacement_file="$migrations_dir/${replacement_version}_${replacement_name}.sql"
    if [ ! -f "$replacement_file" ]; then
      echo "::error::Superseded repair $version requires replacement ${replacement_version}_${replacement_name}.sql" >&2
      return 1
    fi
    echo "::warning::Superseded append-only repair $version is skipped; ${replacement_version}_${replacement_name}.sql will be applied later"
  fi
  skipped_count=$((skipped_count + 1))
}

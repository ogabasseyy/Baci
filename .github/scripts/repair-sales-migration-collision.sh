#!/usr/bin/env bash

# The old wallet entry remains untouched. Register the missing sales SQL under
# a new version before processing migrations that depend on its functions.
repair_sales_migration_collision() {
  local repair_version=20260907111036
  local repair_name=repair_sales_exclusion_wallet_version_collision
  local repair_recorded repair_file
  repair_recorded="$(awk -F '\t' -v version="$repair_version" '$1 == version { print $2; exit }' <<<"$applied_migrations")"
  if [ -n "$repair_recorded" ]; then
    [ "$repair_recorded" = "$repair_name" ] || {
      echo '::error::Sales collision repair has an unexpected recorded name' >&2
      return 1
    }
    return 0
  fi
  repair_file="$migrations_dir/${repair_version}_${repair_name}.sql"
  [ -s "$repair_file" ] || {
    echo '::error::Sales collision requires its append-only repair migration' >&2
    return 1
  }
  apply_pending_migration "$repair_file" "$repair_version" "$repair_name"
}

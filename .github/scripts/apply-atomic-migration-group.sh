#!/usr/bin/env bash

# Apply a small, explicitly ordered migration group in one transaction. The
# caller owns the migration counters and has already defined api_query_payload
# and build_register_migration_query.
apply_atomic_migration_group() {
  local first_file="$1"
  shift
  local -a files=("$first_file" "$@")
  local file base version name sql='' registrations='' body

  for file in "${files[@]}"; do
    base="$(basename "$file" .sql)"
    version="${base%%_*}"
    name="${base#*_}"
    if head -n 1 "$file" | grep -qx -- '-- disable-transaction'; then
      echo "::error::atomic migration group cannot contain non-transactional file $file" >&2
      return 1
    fi
    sql+="${sql:+$'\n'}$(<"$file")"
    registrations+="${registrations:+$'\n'}$(build_register_migration_query "$version" "$name")"
  done

  body="$(jq -n \
    --arg sql "$sql" \
    --arg registrations "$registrations" \
    --arg prefix "BEGIN;
SET LOCAL lock_timeout = '30s';
" \
    '{query: ($prefix + $sql + "\n" + $registrations + "\nCOMMIT;")}')"
  api_query_payload "$body" || return 1

  for file in "${files[@]}"; do
    base="$(basename "$file" .sql)"
    version="${base%%_*}"
    name="${base#*_}"
    echo "✓ applied:         $version  ${name}"
    applied_migrations="${applied_migrations}${applied_migrations:+$'\n'}${version}"$'\t'"${name}"
    applied_count=$((applied_count + 1))
  done
}

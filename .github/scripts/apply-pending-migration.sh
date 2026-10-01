#!/usr/bin/env bash

# Apply one migration after the caller has handled phase, history, collision,
# and atomic-group policy. This keeps the deployment entrypoint small while
# sharing its query and registration helpers through the sourced shell scope.
apply_pending_migration() {
  local file="$1" version="$2" name="$3"

  echo "→ applying:        $version  ${name}"

  if head -n 1 "$file" | grep -qx -- '-- disable-transaction'; then
    echo "  non-transactional migration marker detected"

    # CREATE INDEX CONCURRENTLY fails inside a multi-statement transaction
    # payload. Keep marker migrations idempotent; if a later statement fails,
    # the history row is not written and the next deploy can resume.
    local statement_count=0 statement_json body
    while IFS= read -r statement_json; do
      statement_count=$((statement_count + 1))
      body="$(jq -n --argjson query "$statement_json" '{query: $query}')"
      if ! api_query_payload "$body"; then
        return 1
      fi
    done < <(split_sql_statements "$file")

    if [ "$statement_count" -eq 0 ]; then
      echo "::error::non-transactional migration $file did not contain executable SQL"
      return 1
    fi

    body="$(jq -n \
      --arg query "$(build_register_migration_query "$version" "$name")" \
      '{query: $query}')"
    if ! api_query_payload "$body"; then
      return 1
    fi
    echo "✓ applied:         $version  ${name}"
    applied_migrations="${applied_migrations}${applied_migrations:+$'\n'}${version}"$'\t'"${name}"
    applied_count=$((applied_count + 1))
    return 0
  fi

  # Strip comments before checking for statements that require the marker.
  if sed 's/--.*//' "$file" | grep -qiE '\bconcurrently\b|\bvacuum\b|create[[:space:]]+database|drop[[:space:]]+database|reindex'; then
    echo "::error::$file contains a non-transactional statement but is missing the '-- disable-transaction' first-line marker"
    return 1
  fi

  # Keep the migration SQL and its history row atomic. A lock timeout makes a
  # blocked DDL fail fast so the next deployment can retry it.
  local body
  body="$(jq -n \
    --rawfile sql "$file" \
    --arg registration "$(build_register_migration_query "$version" "$name")" \
    --arg prefix "BEGIN;
SET LOCAL lock_timeout = '30s';
" \
    '{
       query: (
         $prefix
         + $sql
         + "\n"
         + $registration
         + "\nCOMMIT;"
       )
     }'
  )"

  if ! api_query_payload "$body"; then
    return 1
  fi
  echo "✓ applied:         $version  ${name}"
  applied_migrations="${applied_migrations}${applied_migrations:+$'\n'}${version}"$'\t'"${name}"
  applied_count=$((applied_count + 1))
}

#!/usr/bin/env bash

# Report whether any migration that must run after the application deploy is
# still absent from the production migration history. The postdeploy action
# uses this as the durable rollout marker for its one-time long drain.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
migrations_dir="${MIGRATIONS_DIR:-$repo_root/supabase/migrations}"

if [ ! -d "$migrations_dir" ]; then
  echo "::error::supabase/migrations directory not found at $migrations_dir" >&2
  exit 1
fi

if ! . "$script_dir/deferred-production-migrations.sh"; then
  echo "::error::deferred production migration policy could not be loaded" >&2
  exit 1
fi

: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is required}"
: "${SUPABASE_PROJECT_REF:?SUPABASE_PROJECT_REF is required}"

api="https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query"
query_payload="$(jq -n '{query: "SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version"}')"

if ! response="$(curl --fail-with-body --silent --show-error \
  -X POST \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H 'Content-Type: application/json' \
  --data-binary @- \
  "$api" <<<"$query_payload")"; then
  echo "::error::Supabase migration preflight query failed" >&2
  exit 1
fi

if ! jq -e '
  type == "array" and all(.[]; (.version | type == "string") and (.name | type == "string"))
' >/dev/null 2>&1 <<<"$response"; then
  echo "::error::Supabase migration preflight returned an invalid response" >&2
  exit 1
fi

applied_versions="$(jq -r '.[].version' <<<"$response")"

shopt -s nullglob
files=("$migrations_dir"/*.sql)
shopt -u nullglob

for file in "${files[@]}"; do
  base="$(basename "$file" .sql)"
  if ! is_postdeploy_migration "$base"; then
    continue
  fi

  version="${base%%_*}"
  if ! grep -Fqx -- "$version" <<<"$applied_versions"; then
    printf 'true\n'
    printf '::notice::Deferred migration is still pending: %s\n' "$base" >&2
    exit 0
  fi
done

printf 'false\n'

#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
applier="$script_dir/apply-pending-migrations.sh"
fixture_root="$(mktemp -d)"
trap 'rm -rf "$fixture_root"' EXIT

fake_bin="$fixture_root/bin"
mkdir -p "$fake_bin"
cat >"$fake_bin/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
set -euo pipefail

data_binary=''
while (($#)); do
  case "$1" in
    --data-binary)
      if (($# < 2)); then
        echo 'Expected a value for --data-binary' >&2
        exit 2
      fi
      data_binary="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
if [ "$data_binary" != '@-' ]; then
  echo "Expected curl --data-binary @-, got ${data_binary:-<missing>}" >&2
  exit 2
fi

payload="$(cat)"
printf '%s\n' "$payload" >>"$FAKE_QUERY_LOG"
if jq -e '.query | startswith("SELECT version, name")' >/dev/null <<<"$payload"; then
  printf '%s\n' "$FAKE_INITIAL_RESPONSE"
else
  if [ "${FAKE_FAIL_NON_SELECT:-0}" = '1' ]; then
    printf '%s\n' "$FAKE_ERROR_RESPONSE"
    exit 22
  fi
  printf '%s\n' '[]'
fi
FAKE_CURL
chmod +x "$fake_bin/curl"

version_alias_dir="$fixture_root/version-alias"
mkdir -p "$version_alias_dir"
for migration in \
  20261003180000_storefront_available_search_facets.sql \
  20261003193000_storefront_processor_filters.sql \
  20261003194500_storefront_category_facets.sql; do
  cp "$script_dir/../../supabase/migrations/$migration" "$version_alias_dir/$migration"
done
facets_stored_sha='f9c57f6e4670efab9295f83a3cb2db50f06196d244131104c42af04db7f301fd'
processor_stored_sha='cbb407f313bc113344c694eadea4564d10026be75067d5c82d93ed69f0cc0c80'
category_stored_sha='d4fcaf725c66fd10748159bedc1df5f5d3eeba13b2b49b395de8c99eb2c2c1a2'
version_alias_log="$fixture_root/version-alias-queries.log"
version_alias_output="$fixture_root/version-alias-output.log"
PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$version_alias_dir" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$version_alias_log" \
  FAKE_INITIAL_RESPONSE="$(jq -cn \
    --arg facets "$facets_stored_sha" \
    --arg processor "$processor_stored_sha" \
    --arg category "$category_stored_sha" \
    '[
      {version:"20261003175517",name:"storefront_available_search_facets",statements_sha256:$facets},
      {version:"20261003183737",name:"storefront_processor_filters",statements_sha256:$processor},
      {version:"20261003184149",name:"storefront_category_facets",statements_sha256:$category}
    ]')" \
  bash "$applier" >"$version_alias_output"
if ! jq -r '.query' "$version_alias_log" | grep -Fq "CASE WHEN version IN ('20261003175517', '20261003183737', '20261003184149') THEN encode(sha256(convert_to(array_to_json(statements)::text, 'UTF8'))"; then
  echo 'Migration history must hash only the three pinned alias rows' >&2
  exit 1
fi
if ! jq -r '.query' "$version_alias_log" | grep -Fq "FROM supabase_migrations.schema_migrations ORDER BY version"; then
  echo 'Expected the migration history query to retain the full ordered version/name ledger' >&2
  exit 1
fi
grep -q 'already applied under version 20261003175517: 20261003180000  storefront_available_search_facets' "$version_alias_output"
grep -q 'already applied under version 20261003183737: 20261003193000  storefront_processor_filters' "$version_alias_output"
grep -q 'already applied under version 20261003184149: 20261003194500  storefront_category_facets' "$version_alias_output"
grep -q 'Migrations summary: 0 applied, 3 skipped.' "$version_alias_output"
if grep -q 'INSERT INTO supabase_migrations.schema_migrations' "$version_alias_log"; then
  echo 'Verified historical version aliases must not write duplicate migration history' >&2
  exit 1
fi

wrong_version_alias_log="$fixture_root/wrong-version-alias-queries.log"
if PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$version_alias_dir" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$wrong_version_alias_log" \
  FAKE_INITIAL_RESPONSE='[{"version":"20261003175517","name":"storefront_available_search_facets","statements_sha256":"wrong"}]' \
  bash "$applier" >"$fixture_root/wrong-version-alias-output.log" 2>&1; then
  echo 'Expected a historical version alias with a non-matching SQL checksum to fail closed' >&2
  exit 1
fi
grep -q 'failed exact-name or SQL checksum verification' "$fixture_root/wrong-version-alias-output.log"
if grep -q 'INSERT INTO supabase_migrations.schema_migrations' "$wrong_version_alias_log"; then
  echo 'Rejected historical version aliases must not write migration state' >&2
  exit 1
fi

alias_preflight_dir="$fixture_root/alias-preflight"
mkdir -p "$alias_preflight_dir"
cp "$version_alias_dir/20261003180000_storefront_available_search_facets.sql" "$alias_preflight_dir/"
printf 'SELECT 1;\n' >"$alias_preflight_dir/20261003170000_pending_before_alias.sql"
alias_preflight_log="$fixture_root/alias-preflight-queries.log"
if PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$alias_preflight_dir" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$alias_preflight_log" \
  FAKE_INITIAL_RESPONSE='[{"version":"20261003175517","name":"storefront_available_search_facets","statements_sha256":"wrong"}]' \
  bash "$applier" >"$fixture_root/alias-preflight-output.log" 2>&1; then
  echo 'Expected alias verification to fail before applying earlier pending migrations' >&2
  exit 1
fi
grep -q 'failed exact-name or SQL checksum verification' "$fixture_root/alias-preflight-output.log"
if grep -q 'INSERT INTO supabase_migrations.schema_migrations' "$alias_preflight_log"; then
  echo 'A rejected alias must be preflighted before earlier migrations write state' >&2
  exit 1
fi

tampered_version_alias_dir="$fixture_root/tampered-version-alias"
mkdir -p "$tampered_version_alias_dir"
cp "$version_alias_dir/20261003180000_storefront_available_search_facets.sql" \
  "$tampered_version_alias_dir/20261003180000_storefront_available_search_facets.sql"
printf '\n-- tampered after deployment\n' \
  >>"$tampered_version_alias_dir/20261003180000_storefront_available_search_facets.sql"
tampered_version_alias_log="$fixture_root/tampered-version-alias-queries.log"
if PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$tampered_version_alias_dir" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$tampered_version_alias_log" \
  FAKE_INITIAL_RESPONSE="$(jq -cn --arg sha "$facets_stored_sha" \
    '[{version:"20261003175517",name:"storefront_available_search_facets",statements_sha256:$sha}]')" \
  bash "$applier" >"$fixture_root/tampered-version-alias-output.log" 2>&1; then
  echo 'Expected a modified local migration file to fail closed for a historical alias' >&2
  exit 1
fi
grep -q 'failed exact-name or SQL checksum verification' "$fixture_root/tampered-version-alias-output.log"
if grep -q 'INSERT INTO supabase_migrations.schema_migrations' "$tampered_version_alias_log"; then
  echo 'A tampered local migration must not write migration state' >&2
  exit 1
fi

wrong_name_version_alias_log="$fixture_root/wrong-name-version-alias-queries.log"
if PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$version_alias_dir" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$wrong_name_version_alias_log" \
  FAKE_INITIAL_RESPONSE="$(jq -cn --arg sha "$facets_stored_sha" \
    '[{version:"20261003175517",name:"unexpected_alias_name",statements_sha256:$sha}]')" \
  bash "$applier" >"$fixture_root/wrong-name-version-alias-output.log" 2>&1; then
  echo 'Expected an unexpected recorded alias name to fail closed' >&2
  exit 1
fi
grep -q 'failed exact-name or SQL checksum verification' "$fixture_root/wrong-name-version-alias-output.log"
if grep -q 'INSERT INTO supabase_migrations.schema_migrations' "$wrong_name_version_alias_log"; then
  echo 'A rejected alias name must not write migration state' >&2
  exit 1
fi

nameless_version_alias_log="$fixture_root/nameless-version-alias-queries.log"
if PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$version_alias_dir" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$nameless_version_alias_log" \
  FAKE_INITIAL_RESPONSE="$(jq -cn --arg sha "$facets_stored_sha" \
    '[{version:"20261003175517",name:"",statements_sha256:$sha}]')" \
  bash "$applier" >"$fixture_root/nameless-version-alias-output.log" 2>&1; then
  echo 'Expected a present historical alias row with an empty name to fail closed' >&2
  exit 1
fi
grep -q 'failed exact-name or SQL checksum verification' "$fixture_root/nameless-version-alias-output.log"
if grep -q 'INSERT INTO supabase_migrations.schema_migrations' "$nameless_version_alias_log"; then
  echo 'A nameless historical alias row must not be treated as absent or write migration state' >&2
  exit 1
fi

capped_version_alias_dir="$fixture_root/capped-version-alias"
mkdir -p "$capped_version_alias_dir"
cp "$version_alias_dir/20261003193000_storefront_processor_filters.sql" \
  "$capped_version_alias_dir/20261003193000_storefront_processor_filters.sql"
capped_version_alias_log="$fixture_root/capped-version-alias-queries.log"
capped_version_alias_output="$fixture_root/capped-version-alias-output.log"
PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$capped_version_alias_dir" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$capped_version_alias_log" \
  FAKE_INITIAL_RESPONSE="$(jq -cn '[{version:"20261003183737",name:"storefront_processor_filters",statements_sha256:"wrong"}]')" \
  MIGRATION_MAX_VERSION=20261003190000 \
  bash "$applier" >"$capped_version_alias_output"
grep -q 'deferred above MIGRATION_MAX_VERSION 20261003190000: 20261003193000  storefront_processor_filters' "$capped_version_alias_output"
grep -q 'Migrations summary: 0 applied, 0 skipped, 1 deferred.' "$capped_version_alias_output"
if grep -q 'INSERT INTO supabase_migrations.schema_migrations' "$capped_version_alias_log"; then
  echo 'An out-of-scope historical alias must remain deferred despite a mismatched hash' >&2
  exit 1
fi

absent_version_alias_log="$fixture_root/absent-version-alias-queries.log"
absent_version_alias_output="$fixture_root/absent-version-alias-output.log"
PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$version_alias_dir" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$absent_version_alias_log" \
  FAKE_INITIAL_RESPONSE='[]' \
  bash "$applier" >"$absent_version_alias_output"
grep -q 'applied:         20261003180000  storefront_available_search_facets' "$absent_version_alias_output"
grep -q 'Migrations summary: 3 applied, 0 skipped.' "$absent_version_alias_output"
if [ "$(grep -c 'INSERT INTO supabase_migrations.schema_migrations' "$absent_version_alias_log")" -ne 3 ]; then
  echo 'Absent historical aliases must continue through the regular three-migration apply path' >&2
  exit 1
fi


# A correct current-version row must not mask a malformed recorded alias row.
both_versions_log="$fixture_root/current-and-alias-queries.log"
if PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$version_alias_dir" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$both_versions_log" \
  FAKE_INITIAL_RESPONSE='[{"version":"20261003175517","name":"storefront_available_search_facets","statements_sha256":"wrong"},{"version":"20261003180000","name":"storefront_available_search_facets"}]' \
  bash "$applier" >"$fixture_root/current-and-alias-output.log" 2>&1; then
  echo 'Expected a malformed historical alias to fail even when the current version is recorded' >&2
  exit 1
fi
grep -q 'failed exact-name or SQL checksum verification' "$fixture_root/current-and-alias-output.log"
if grep -q 'INSERT INTO supabase_migrations.schema_migrations' "$both_versions_log"; then
  echo 'A bad recorded alias must block writes even when the current migration row exists' >&2
  exit 1
fi

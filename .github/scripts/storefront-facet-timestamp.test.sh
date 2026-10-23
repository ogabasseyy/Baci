#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "${FACET_HANDLER:-$script_dir/historical-migration-repair-handler.sh}"
fixture="$(mktemp)"
trap 'rm -f "$fixture"' EXIT
printf 'SELECT 1;\n' > "$fixture"
build_register_migration_query() { printf 'INSERT canonical %s %s;' "$1" "$2"; }
api_query_payload() { payload="$1"; [ "${reject_payload:-false}" = false ]; }
applied_count=0
applied_migrations=$'20261003175517\tstorefront_available_search_facets'
reconcile_storefront_facet_timestamp 20261003180000 storefront_available_search_facets "$fixture"
[ "$applied_count" = 1 ]
jq -er '.query | contains("statements = ARRAY[convert_from(decode(") and contains("U0VMRUNUIDE7Cg==") and contains("BEGIN;") and contains("COMMIT;") and contains("INSERT canonical 20261003180000")' <<< "$payload" >/dev/null
# A failed SQL equality assertion must not update local migration history.
reject_payload=true
applied_count=0
if reconcile_storefront_facet_timestamp 20261003180000 storefront_available_search_facets "$fixture"; then exit 1; fi
[ "$applied_count" = 0 ]
reject_payload=false
# Missing historical row follows ordinary execution; wrong name fails closed.
applied_migrations=''
status=0
reconcile_storefront_facet_timestamp 20261003180000 storefront_available_search_facets "$fixture" || status=$?
[ "$status" = 2 ]
applied_migrations=$'20261003175517\tunrelated'
status=0
reconcile_storefront_facet_timestamp 20261003180000 storefront_available_search_facets "$fixture" || status=$?
[ "$status" = 1 ]
# Pin every alias, including both subsequent CREATE FUNCTION migrations.
for pair in '20261003193000 storefront_processor_filters 20261003183737' '20261003194500 storefront_category_facets 20261003184149'; do
  read -r canonical name historical <<< "$pair"
  applied_migrations="${historical}"$'\t'"${name}"
  reconcile_storefront_facet_timestamp "$canonical" "$name" "$fixture"
  jq -er --arg version "$historical" '.query | contains($version)' <<< "$payload" >/dev/null
done
echo 'Facet timestamp reconciliation tests passed'

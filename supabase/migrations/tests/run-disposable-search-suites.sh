#!/usr/bin/env bash
# Disposable search-suite runner: executes the fixture-style SQL suites that
# cannot run in the migration-replay gate (they CREATE their own minimal
# schema) against the LIVE search migration chain, one fresh database per
# suite. Fails closed on the first error (psql ON_ERROR_STOP=1 + set -e).
#
# Usage (CI provides PGHOST/PGPORT/PGUSER/PGPASSWORD for a postgres:18
# service; locally point them at any empty postgres 18 server):
#   bash supabase/migrations/tests/run-disposable-search-suites.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TESTS="$ROOT/supabase/migrations/tests"
MIGRATIONS="$ROOT/supabase/migrations"

: "${PGHOST:=localhost}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
export PGHOST PGPORT PGUSER

# Live search chain in dependency order: pure CREATE OR REPLACE FUNCTION
# files (no bare DDL), so each suite tests the shipped definitions, not a
# pinned snapshot. When a new search migration lands, append it here if it
# redefines a function these suites call.
CHAIN=(
  20261002090046_storefront_search_refinements.sql
  20261003180000_storefront_available_search_facets.sql
  20261003193000_storefront_processor_filters.sql
  20261003230000_storefront_search_refinement_fixes.sql
  20261004193000_private_purchasable_search_candidates.sql
  20261004210000_bounded_refined_search_offsets.sql
  20261004230000_storefront_search_brand_case_insensitive.sql
  20261008090001_search_processor_filter_bounds.sql
  20261008100000_search_candidate_query_length_first.sql
  20261008110000_search_processor_refined_drop_redundant_exists.sql
  20261008120001_search_processor_filter_case_insensitive.sql
  20261008150000_search_platform_admin_visibility.sql
  20261008180000_search_price_options_same_condition_offers.sql
  20261008190000_search_price_options_offer_pdp_window.sql
  20261008240000_search_candidate_admin_visibility_predicate.sql
  20261008370000_search_processor_filter_before_precise_prune.sql
  20261010110000_search_category_facets_scoped_precise.sql
  20261016090000_search_condition_match_hyphen.sql
)

fresh_db() {
  local db="$1"
  psql -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS $db;" -c "CREATE DATABASE $db;" postgres >/dev/null
  echo "--- $db"
}

# Self-contained suites (\ir their own fixture + migration).
run_standalone() {
  local db="$1" suite="$2"
  fresh_db "$db"
  psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$TESTS/$suite" >/dev/null
  echo "PASS $suite"
}

# Chain suites: base fixture -> optional extra fixture -> shims -> live
# chain -> optional prefix suite (same DB) -> suite as the given role.
run_chain() {
  local db="$1" suite="$2" role="$3" extra_fixture="$4" prefix_suite="$5"
  fresh_db "$db"
  local args=(-f "$TESTS/storefront_search_refinements_fixture.sql")
  if [ -n "$extra_fixture" ]; then
    args+=(-f "$TESTS/$extra_fixture")
  fi
  args+=(-f "$TESTS/disposable_suite_shims.sql")
  local migration
  for migration in "${CHAIN[@]}"; do
    args+=(-f "$MIGRATIONS/$migration")
  done
  if [ -n "$prefix_suite" ]; then
    args+=(-f "$TESTS/$prefix_suite")
  fi
  args+=(-c "SET ROLE $role;" -f "$TESTS/$suite")
  psql -v ON_ERROR_STOP=1 -q -d "$db" "${args[@]}" >/dev/null
  echo "PASS $suite"
}

run_standalone suite_private_candidates private_search_candidates.sql
run_standalone suite_bounded_offsets bounded_refined_search_offsets.sql
run_chain suite_processor storefront_processor_filters.sql postgres "" ""
run_chain suite_refinements storefront_search_refinements.sql anon "" ""
run_chain suite_available_facets storefront_available_search_facets.sql postgres storefront_available_search_facets_fixture.sql ""
run_chain suite_category_facets storefront_category_facets.sql postgres storefront_available_search_facets_fixture.sql storefront_processor_filters.sql
run_chain suite_inventory_guards search_inventory_option_guards.sql postgres "" ""

echo "All disposable search suites passed."

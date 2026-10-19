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
  20261003194500_storefront_category_facets.sql
  20261003230000_storefront_search_refinement_fixes.sql
  20261004060000_search_inventory_option_guards.sql
  20261004131000_search_price_options_offer_base_rows.sql
  20261004151000_search_price_options_offer_scope_null_stock.sql
  20261004193000_private_purchasable_search_candidates.sql
  20261004210000_bounded_refined_search_offsets.sql
  20261004230000_storefront_search_brand_case_insensitive.sql
  20261008090001_search_processor_filter_bounds.sql
  20261008100000_search_candidate_query_length_first.sql
  20261008110000_search_processor_refined_drop_redundant_exists.sql
  20261008120001_search_processor_filter_case_insensitive.sql
  20261008130001_search_price_options_null_stock_managed.sql
  20261008140000_search_price_options_sku_matrix_drift.sql
  20261008150000_search_platform_admin_visibility.sql
  20261008160000_search_price_options_offer_parent_stock.sql
  20261008180000_search_price_options_same_condition_offers.sql
  20261008190000_search_price_options_offer_pdp_window.sql
  20261008200000_search_price_options_variant_population_guard.sql
  20261008240000_search_candidate_admin_visibility_predicate.sql
  20261008340000_storefront_search_offer_serialized_unit_gate.sql
  20261008360000_storefront_search_offer_unlimited_scalar_gate.sql
  20261008370000_search_processor_filter_before_precise_prune.sql
  20261008430000_storefront_search_offer_unmanaged_scalar.sql
  20261010110000_search_category_facets_scoped_precise.sql
  20261016090000_search_condition_match_hyphen.sql
)

# Registration guard: every storefront-search function migration must be
# classified below — CHAIN when a disposable suite calls (transitively
# or directly) a function it defines, EXCLUDED with a reason otherwise.
# A new search migration fails this gate until its author classifies it,
# so the suites cannot silently pass against stale shipped definitions.
SEARCH_FILE_PATTERN='search|facet|storefront_processor|storefront_category'
EXCLUDED=(
  # Legacy product-search v2 family: not called by disposable suites.
  20260617120000_product_search_locale_normalization.sql
  20260621130000_search_products_v2_two_tier.sql
  20260628130000_search_products_v2_admin_effective_stock.sql
  20260702024830_fix_search_products_condition_filter.sql
  20260713212000_optimize_product_search_suggestion_v2.sql
  20260827100000_fix_search_products_not_archived_nulls.sql
  # Admin notification/merchant health repairs: admin RPCs, not suites.
  20260809184000_repair_admin_notification_dashboard_literal_search.sql
  20260811100001_repair_admin_merchant_search_and_push_health.sql
  # Discovery/MCP/research search: separate RPC families, not suites.
  20260930210000_product_discovery_fact_search.sql
  20261001002000_combined_product_discovery_search.sql
  20261001080000_correlated_text_attribute_search.sql
  20261001140000_bounded_mcp_search_options.sql
  20261001190000_ascii_mcp_search_browse.sql
  20261002090724_bounded_search_option_projection.sql
  20261002222000_guard_discovery_research_source.sql
  20261002233000_lossless_discovery_research_revision.sql
  20261003021500_authorize_discovery_research_reader.sql
  # Category slug-state RPC: not called by any disposable suite.
  20260531173100_add_storefront_category_slug_state_rpc.sql
  20260602090000_fix_storefront_category_slug_state_missing_row.sql
  # Admin transaction-review RPCs: covered by the replay gate's
  # --sql-check suites; not called by disposable suites.
  20261008174300_search_mobile_admin_transaction_review_orders.sql
  20261009340000_search_mobile_admin_transaction_review_offer_labels.sql
  20261011230000_search_mobile_admin_transaction_review_item_condition.sql
  # Search analytics ingest policy: DDL-only, not a suite function.
  20261010000000_search_analytics_service_role_only_insert.sql
  # Merchant visibility RPC: new function, not a redefinition, and not
  # called by any disposable suite; covered by the replay --sql-check
  # storefront_refined_reread_anon_visibility suite instead.
  20261016170000_storefront_search_merchant_visibility_rpc.sql
  # Shared-cart terminal purge: matched the registration pattern only via
  # "search_path"; no disposable search suite calls the purge function
  # (covered by the commerce_cart_terminal_purge replay suite instead).
  20261015159000_commerce_cart_purge_search_path.sql
  20261015179950_commerce_cart_purge_search_path.sql
)

check_chain_registration() {
  local file entry classified
  while IFS= read -r file; do
    classified=false
    for entry in "${CHAIN[@]}" "${EXCLUDED[@]}"; do
      if [ "$file" = "$entry" ]; then
        classified=true
        break
      fi
    done
    if [ "$classified" = false ]; then
      echo "UNREGISTERED search migration: $file (classify it in CHAIN or EXCLUDED above)" >&2
      exit 1
    fi
  done < <(ls "$MIGRATIONS" | grep -E "$SEARCH_FILE_PATTERN" | sort)
}

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

check_chain_registration

run_standalone suite_private_candidates private_search_candidates.sql
run_standalone suite_bounded_offsets bounded_refined_search_offsets.sql
run_chain suite_processor storefront_processor_filters.sql postgres "" ""
run_chain suite_refinements storefront_search_refinements.sql anon "" ""
run_chain suite_available_facets storefront_available_search_facets.sql postgres storefront_available_search_facets_fixture.sql ""
run_chain suite_category_facets storefront_category_facets.sql postgres storefront_available_search_facets_fixture.sql storefront_processor_filters.sql
run_chain suite_inventory_guards search_inventory_option_guards.sql postgres "" ""

echo "All disposable search suites passed."

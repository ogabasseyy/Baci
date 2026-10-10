import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SEARCH_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-search-pending-sources';

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');

describe('search pending replay sources', () => {
  it('pins all pending search migrations to their checked-in bytes', async () => {
    const rows = SEARCH_PENDING_REPLAY_SOURCE_ROWS.split('\n');
    expect(rows.map((row) => row.split(' ')[1])).toEqual([
      '20260827100000_fix_search_products_not_archived_nulls.sql',
      '20261002090046_storefront_search_refinements.sql',
      '20261002190000_storefront_product_requests.sql',
      '20261003180000_storefront_available_search_facets.sql',
      '20261003193000_storefront_processor_filters.sql',
      '20261003194500_storefront_category_facets.sql',
      '20261003230000_storefront_search_refinement_fixes.sql',
      '20261004060000_search_inventory_option_guards.sql',
      '20261004131000_search_price_options_offer_base_rows.sql',
      '20261004151000_search_price_options_offer_scope_null_stock.sql',
      '20261004170500_restrict_storefront_product_request_intake.sql',
      '20261004193000_private_purchasable_search_candidates.sql',
      '20261004210000_bounded_refined_search_offsets.sql',
      '20261004230000_storefront_search_brand_case_insensitive.sql',
      '20261008090000_search_processor_filter_bounds.sql',
      '20261008100000_search_candidate_query_length_first.sql',
      '20261008110000_search_processor_refined_drop_redundant_exists.sql',
      '20261008120001_search_processor_filter_case_insensitive.sql',
      '20261008130001_search_price_options_null_stock_managed.sql',
      '20261008140000_search_price_options_sku_matrix_drift.sql',
      '20261008150000_search_platform_admin_visibility.sql',
      '20261008160000_search_price_options_offer_parent_stock.sql',
      '20261008170000_storefront_product_request_platform_admin.sql',
      '20261008180000_search_price_options_same_condition_offers.sql',
      '20261008190000_search_price_options_offer_pdp_window.sql',
      '20261008200000_search_price_options_variant_population_guard.sql',
      '20261008210000_storefront_product_request_contact_canonical.sql',
      '20261008220000_storefront_product_request_outcome_codes.sql',
      '20261008230001_storefront_product_request_contact_intl_prefix.sql',
      '20261008240000_search_candidate_admin_visibility_predicate.sql',
      '20261008250000_storefront_product_request_contact_zero_run.sql',
      '20261008260000_storefront_product_request_query_key.sql',
      '20261008270000_storefront_variant_rpc_serialized_policy.sql',
      '20261008280000_storefront_variant_rpc_admin_visibility.sql',
      '20261008290000_storefront_product_base_inventory.sql',
      '20261008300000_storefront_order_item_offer.sql',
      '20261008310000_storefront_order_offer_economics.sql',
      '20261008320000_storefront_order_item_offer_delete_rule.sql',
      '20261008330000_storefront_restock_offer_serialized_policy.sql',
      '20261008340000_storefront_search_offer_serialized_unit_gate.sql',
      '20261008350000_storefront_order_offer_line_discriminator.sql',
      '20261008360000_storefront_search_offer_unlimited_scalar_gate.sql',
      '20261008370000_search_processor_filter_before_precise_prune.sql',
      '20261008380000_storefront_order_offer_unlimited_allocation.sql',
      '20261008390000_storefront_restock_offer_unlimited_scalar.sql',
      '20261008400000_storefront_order_offer_managed_guard.sql',
      '20261008410000_storefront_restock_offer_unmanaged_parent.sql',
      '20261008420000_storefront_strict_offer_scalar.sql',
      '20261008430000_storefront_search_offer_unmanaged_scalar.sql',
      '20261008440000_storefront_redvault_refund_offer_scalar.sql',
      '20261008450000_storefront_redvault_refund_offer_single_owner.sql',
      '20261008460000_storefront_order_offer_line_integrity.sql',
      '20261009320000_storefront_order_offer_label_snapshot.sql',
      '20261009330000_storefront_order_offer_label_snapshot_marker.sql',
      '20261009340000_search_mobile_admin_transaction_review_offer_labels.sql',
    ]);
    for (const row of rows) {
      const [sha256, filename, ...extra] = row.split(' ');
      expect(extra).toEqual([]);
      const migration = await readFile(
        path.join(REPOSITORY_ROOT, 'supabase/migrations', filename)
      );
      expect(createHash('sha256').update(migration).digest('hex')).toBe(sha256);
    }
  });
});

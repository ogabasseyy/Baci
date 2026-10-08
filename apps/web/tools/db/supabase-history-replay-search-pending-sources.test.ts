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
      '20261008120000_search_processor_filter_case_insensitive.sql',
      '20261008130000_search_price_options_null_stock_managed.sql',
      '20261008140000_search_price_options_sku_matrix_drift.sql',
      '20261008150000_search_platform_admin_visibility.sql',
      '20261008160000_search_price_options_offer_parent_stock.sql',
      '20261008170000_storefront_product_request_platform_admin.sql',
      '20261008180000_search_price_options_same_condition_offers.sql',
      '20261008190000_search_price_options_offer_pdp_window.sql',
      '20261008200000_search_price_options_variant_population_guard.sql',
      '20261008210000_storefront_product_request_contact_canonical.sql',
      '20261008220000_storefront_product_request_outcome_codes.sql',
      '20261008230000_storefront_product_request_contact_intl_prefix.sql',
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

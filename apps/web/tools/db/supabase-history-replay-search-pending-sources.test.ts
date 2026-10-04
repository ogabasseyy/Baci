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
      '20261004130000_search_price_options_offer_base_rows.sql',
      '20261004150000_search_price_options_offer_scope_null_stock.sql',
      '20261004170000_restrict_storefront_product_request_intake.sql',
      '20261004193000_private_purchasable_search_candidates.sql',
      '20261004210000_bounded_refined_search_offsets.sql',
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

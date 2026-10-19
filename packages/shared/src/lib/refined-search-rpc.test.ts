import { describe, expect, it } from 'vitest';
import {
  getRefinedSearchArgs,
  REFINED_SEARCH_MAX_OFFSET,
  readRefinedSearchRows,
} from './refined-search-rpc';

describe('refined-search-rpc barrel', () => {
  it('re-exports the offset constant, args builder, and row reader', () => {
    expect(REFINED_SEARCH_MAX_OFFSET).toBe(1980);
    expect(
      getRefinedSearchArgs('m1', 'phone', { brands: [], sort: 'relevance' }, 20)
        .result_offset
    ).toBe(0);
    expect(
      readRefinedSearchRows([{ product_id: 'p1', total_count: 1 }])
    ).toEqual([{ productId: 'p1', total: 1 }]);
  });
});

import { describe, expect, it } from 'vitest';
import { POST_FILTER_RESULT_PAGE_SIZE } from './search-products-ranking';
import { loadMcpSearchProducts } from './search-products-query';
import { createRankedSearchSupabase } from './search-products-query.test-utils';

describe('ranked intent pagination', () => {
  it('backfills lexical candidates after intent filtering rejects the first ranked page', async () => {
    const { rpc, supabase } = createRankedSearchSupabase('Printers', (id) =>
      id === 'ranked-100' ? 'Google Pixel Buds Pro' : 'HP Wireless Printer',
      (id) => id === 'ranked-100' ? 'Wireless earbuds with noise cancelling' : ''
    );
    const result = await loadMcpSearchProducts({
      args: { query: 'wireless earbuds', limit: 1 }, merchantId: 'merchant-1',
      sanitizeString: (input) => input, supabase,
    });

    expect(result.products.map((product) => product.name)).toEqual(['Google Pixel Buds Pro']);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls.map(([, args]) => args.result_offset)).toEqual([0, POST_FILTER_RESULT_PAGE_SIZE]);
  });

  it('scans further ranked pages for single-word model queries', async () => {
    const { rpc, supabase } = createRankedSearchSupabase('Laptops', (id) =>
      id === `ranked-${POST_FILTER_RESULT_PAGE_SIZE}` ? 'MacBook Air M3' : 'MacBook Air M2'
    );
    const result = await loadMcpSearchProducts({
      args: { query: 'MacBook M3', limit: 1 }, merchantId: 'merchant-1',
      sanitizeString: (input) => input, supabase,
    });

    expect(result.products.map((product) => product.name)).toEqual(['MacBook Air M3']);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls.map(([, args]) => args.result_offset)).toEqual([0, POST_FILTER_RESULT_PAGE_SIZE]);
  });
});

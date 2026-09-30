import { expect, it } from 'vitest';
import { loadMcpSearchProducts } from './search-products-query';
import { createRankedSearchSupabase } from './search-products-query.test-utils';

it('backfills short TV intent after rejecting accessory rows', async () => {
  const { rpc, supabase } = createRankedSearchSupabase('Accessories', (id) =>
    id === 'ranked-150' ? 'Samsung TV Television' : 'TV Stand'
  );
  const result = await loadMcpSearchProducts({
    args: { query: 'TV', limit: 1 }, merchantId: 'merchant-1',
    sanitizeString: (value) => value, supabase,
  });
  expect(result.products.map((product) => product.name)).toEqual(['Samsung TV Television']);
  expect(rpc.mock.calls.length).toBeGreaterThan(1);
});

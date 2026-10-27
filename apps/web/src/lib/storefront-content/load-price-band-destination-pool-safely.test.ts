import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedPriceBandDestinationProjection } from './get-cached-price-band-destination-projection';
import { loadPriceBandDestinationPoolSafely } from './load-price-band-destination-pool-safely';

vi.mock('./get-cached-price-band-destination-projection', () => ({
  getCachedPriceBandDestinationProjection: vi.fn(),
}));
// Importing the rich loader on this optional path would regress the query fanout.
vi.mock('@/lib/cached-data', () => {
  throw new Error('Full category loader must not be imported');
});
const read = vi.mocked(getCachedPriceBandDestinationProjection);
const args = {
  merchantId: 'm1',
  merchantSlug: 'ogabassey',
  categorySlug: 'smartphones',
};
beforeEach(() => vi.clearAllMocks());

describe('loadPriceBandDestinationPoolSafely', () => {
  it('uses the bounded projection with tenant and category scope', async () => {
    const products = [
      { slug: 'phone', name: 'Phone', brand: 'Apple', price: 500000 },
    ];
    read.mockResolvedValue(products);
    expect(await loadPriceBandDestinationPoolSafely(args)).toEqual(products);
    expect(read).toHaveBeenCalledWith('m1', 'smartphones');
  });

  it.each([
    { result: null },
    { result: [] },
  ])('preserves a fail-closed or genuinely empty result', async ({
    result,
  }) => {
    read.mockResolvedValue(result);
    expect(await loadPriceBandDestinationPoolSafely(args)).toEqual(result);
  });

  it('drops optional links on read errors and aborted requests', async () => {
    read.mockRejectedValue(new DOMException('deadline', 'TimeoutError'));
    expect(await loadPriceBandDestinationPoolSafely(args)).toBeNull();
  });
});

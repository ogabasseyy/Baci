import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: null as null | { enabled: boolean; queryFn: () => Promise<unknown> },
  merchantId: 'merchant-1' as string | null,
  select: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: (config: typeof mocks.query) => {
    mocks.query = config;
    return config;
  },
}));
vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({
    merchant: mocks.merchantId ? { id: mocks.merchantId } : null,
  }),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: { from: () => ({ select: mocks.select }) },
}));

import { useInventoryConditionOffers } from './useInventoryConditionOffers';

describe('useInventoryConditionOffers', () => {
  beforeEach(() => {
    mocks.query = null;
    mocks.merchantId = 'merchant-1';
    mocks.select.mockReset().mockReturnValue({ eq: mocks.eq });
    mocks.eq.mockReset().mockReturnValue({ eq: mocks.eq, order: mocks.order });
    mocks.order.mockReset();
  });
  it('scopes condition offers to the merchant and product', async () => {
    const rows = [{ id: 'offer-1', condition: 'used', status: 'active' }];
    mocks.order.mockResolvedValueOnce({ data: rows, error: null });
    useInventoryConditionOffers('product-1', true);
    expect(mocks.query?.enabled).toBe(true);
    await expect(mocks.query?.queryFn()).resolves.toEqual(rows);
    expect(mocks.select).toHaveBeenCalledWith('id, condition, status');
    expect(mocks.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(mocks.eq).toHaveBeenCalledWith('product_id', 'product-1');
  });
  it('disables loading for variant products or missing merchants', () => {
    useInventoryConditionOffers('product-1', false);
    expect(mocks.query?.enabled).toBe(false);
    mocks.merchantId = null;
    useInventoryConditionOffers('product-1', true);
    expect(mocks.query?.enabled).toBe(false);
  });
  it('rejects malformed results rather than offering an incorrect condition', async () => {
    mocks.order.mockResolvedValueOnce({
      data: [{ id: 'offer-1', condition: 123 }],
      error: null,
    });
    useInventoryConditionOffers('product-1', true);
    await expect(mocks.query?.queryFn()).rejects.toThrow(
      'Invalid condition offers'
    );
  });
});

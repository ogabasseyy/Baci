import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  expire: vi.fn(),
  revalidate: vi.fn(),
  purge: vi.fn(),
}));
vi.mock('next/server', () => ({ after: mocks.after }));
vi.mock('./cache-revalidation', () => ({
  revalidateProducts: mocks.revalidate,
}));
vi.mock('./expire-product-blog-cache', () => ({
  expireProductBlogCache: mocks.expire,
}));
vi.mock('./storefront-product-purge-hostnames', () => ({
  scheduleStorefrontHostnamePurge: mocks.purge,
}));

import { scheduleReusedOrderInventoryPurge } from './schedule-reused-order-inventory-purge';

describe('scheduleReusedOrderInventoryPurge', () => {
  beforeEach(() => vi.clearAllMocks());
  it('invalidates reclaimed stock without reading guest order items', async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi
        .fn()
        .mockResolvedValue({ data: { slug: 'store' }, error: null }),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const supabase = { from: vi.fn().mockReturnValue(query) };
    scheduleReusedOrderInventoryPurge({
      merchantId: 'merchant-1',
      supabase: supabase as never,
    });
    expect(mocks.revalidate).toHaveBeenCalledWith('merchant-1', undefined, {
      expireImmediately: true,
    });
    expect(supabase.from).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0][0]();
    expect(supabase.from).toHaveBeenCalledExactlyOnceWith('merchants');
    expect(query.eq).toHaveBeenCalledWith('id', 'merchant-1');
    expect(mocks.purge).toHaveBeenCalledWith('store');
    expect(mocks.expire.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.purge.mock.invocationCallOrder[0]
    );
  });
  it('keeps an already committed order successful when the public lookup fails', async () => {
    const supabase = {
      from: vi.fn(() => {
        throw new Error('temporary failure');
      }),
    };
    scheduleReusedOrderInventoryPurge({
      merchantId: 'm1',
      supabase: supabase as never,
    });
    await expect(mocks.after.mock.calls[0][0]()).resolves.toBeUndefined();
    expect(mocks.purge).not.toHaveBeenCalled();
  });
});

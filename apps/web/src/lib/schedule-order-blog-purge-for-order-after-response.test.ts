import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockAfter,
  mockScheduleOrderProductBlogPurge,
  mockScheduleStorefrontHostnamePurge,
  mockRevalidateProducts,
  mockExpireProductBlogCache,
} = vi.hoisted(() => ({
  mockAfter: vi.fn(),
  mockScheduleOrderProductBlogPurge: vi.fn(),
  mockScheduleStorefrontHostnamePurge: vi.fn(),
  mockRevalidateProducts: vi.fn(),
  mockExpireProductBlogCache: vi.fn(),
}));

vi.mock('next/server', () => ({ after: mockAfter }));
vi.mock('./cache-revalidation', () => ({
  revalidateProducts: (...args: unknown[]) => mockRevalidateProducts(...args),
}));
vi.mock('./expire-product-blog-cache', () => ({
  expireProductBlogCache: (...args: unknown[]) =>
    mockExpireProductBlogCache(...args),
}));
vi.mock('./schedule-order-product-blog-purge', () => ({
  scheduleOrderProductBlogPurge: (...args: unknown[]) =>
    mockScheduleOrderProductBlogPurge(...args),
}));
vi.mock('./storefront-product-purge-hostnames', () => ({
  scheduleStorefrontHostnamePurge: (...args: unknown[]) =>
    mockScheduleStorefrontHostnamePurge(...args),
}));

import { scheduleOrderBlogPurgeForOrderAfterResponse } from './schedule-order-blog-purge-for-order-after-response';

function makeSupabase(result: { data: unknown; error: unknown }) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => Promise.resolve(result)),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
  };
  return { from: vi.fn(() => builder) };
}

function makeFailingItemsSupabase(merchantSlug: string | null) {
  const itemsBuilder: Record<string, unknown> = {};
  itemsBuilder.select = vi.fn(() => itemsBuilder);
  itemsBuilder.eq = vi.fn(() =>
    Promise.resolve({ data: null, error: new Error('read failed') })
  );
  const merchantsBuilder: Record<string, unknown> = {};
  merchantsBuilder.select = vi.fn(() => merchantsBuilder);
  merchantsBuilder.eq = vi.fn(() => merchantsBuilder);
  merchantsBuilder.maybeSingle = vi.fn(() =>
    Promise.resolve({
      data: merchantSlug ? { slug: merchantSlug } : null,
      error: null,
    })
  );
  return {
    from: vi.fn((table: string) =>
      table === 'merchants' ? merchantsBuilder : itemsBuilder
    ),
  };
}

function makeRejectingItemsSupabase(merchantSlug: string | null) {
  const itemsBuilder: Record<string, unknown> = {};
  itemsBuilder.select = vi.fn(() => itemsBuilder);
  itemsBuilder.eq = vi.fn(() => Promise.reject(new Error('transport down')));
  const merchantsBuilder: Record<string, unknown> = {};
  merchantsBuilder.select = vi.fn(() => merchantsBuilder);
  merchantsBuilder.eq = vi.fn(() => merchantsBuilder);
  merchantsBuilder.maybeSingle = vi.fn(() =>
    Promise.resolve({
      data: merchantSlug ? { slug: merchantSlug } : null,
      error: null,
    })
  );
  return {
    from: vi.fn((table: string) =>
      table === 'merchants' ? merchantsBuilder : itemsBuilder
    ),
  };
}

describe('scheduleOrderBlogPurgeForOrderAfterResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('looks up distinct order-item products after the response', async () => {
    let callback: (() => unknown) | undefined;
    mockAfter.mockImplementation((next: () => unknown) => {
      callback = next;
    });
    const supabase = makeSupabase({
      data: [
        { product_id: 'product-1' },
        { product_id: ' product-1 ' },
        { product_id: 'product-2' },
      ],
      error: null,
    });

    scheduleOrderBlogPurgeForOrderAfterResponse({
      supabase: supabase as never,
      merchantId: 'merchant-1',
      orderId: 'order-1',
    });

    expect(mockScheduleOrderProductBlogPurge).not.toHaveBeenCalled();
    await callback?.();
    expect(supabase.from).toHaveBeenCalledWith('order_items');
    expect(mockScheduleOrderProductBlogPurge).toHaveBeenCalledWith({
      supabase,
      merchantId: 'merchant-1',
      productIds: ['product-1', 'product-2'],
    });
  });

  it('does not schedule when the order has no product rows', async () => {
    const emptySupabase = makeSupabase({ data: [], error: null });
    mockAfter.mockImplementationOnce((next: () => unknown) => next());
    scheduleOrderBlogPurgeForOrderAfterResponse({
      supabase: emptySupabase as never,
      merchantId: 'merchant-1',
      orderId: 'order-1',
    });
    await Promise.resolve();
    expect(mockScheduleOrderProductBlogPurge).not.toHaveBeenCalled();
    expect(mockScheduleStorefrontHostnamePurge).not.toHaveBeenCalled();
  });

  it('falls back to a hostname purge when the committed order-item read fails', async () => {
    // The reclamation already committed: without product IDs the targeted
    // purge cannot run, so evict the whole storefront instead of leaving
    // freshly reserved units advertised on the edge.
    const failedSupabase = makeFailingItemsSupabase('ogabassey');
    let pending: Promise<unknown> | undefined;
    mockAfter.mockImplementationOnce((next: () => unknown) => {
      pending = Promise.resolve(next());
    });
    scheduleOrderBlogPurgeForOrderAfterResponse({
      supabase: failedSupabase as never,
      merchantId: 'merchant-1',
      orderId: 'order-1',
    });
    await pending;
    expect(mockScheduleOrderProductBlogPurge).not.toHaveBeenCalled();
    // The merchant caches are hard-expired BEFORE the hostname purge: the
    // preceding revalidation is stale-while-revalidate, so the first
    // post-purge request could otherwise refill the edge with the
    // pre-reclamation snapshot.
    expect(mockRevalidateProducts).toHaveBeenCalledWith(
      'merchant-1',
      undefined,
      { expireImmediately: true }
    );
    expect(mockExpireProductBlogCache).toHaveBeenCalledWith('merchant-1');
    expect(mockScheduleStorefrontHostnamePurge).toHaveBeenCalledWith(
      'ogabassey'
    );
    expect(mockRevalidateProducts.mock.invocationCallOrder[0]).toBeLessThan(
      mockScheduleStorefrontHostnamePurge.mock.invocationCallOrder[0]
    );
  });

  it('skips the fallback when the merchant slug cannot be resolved', async () => {
    const failedSupabase = makeFailingItemsSupabase(null);
    let pending: Promise<unknown> | undefined;
    mockAfter.mockImplementationOnce((next: () => unknown) => {
      pending = Promise.resolve(next());
    });
    scheduleOrderBlogPurgeForOrderAfterResponse({
      supabase: failedSupabase as never,
      merchantId: 'merchant-1',
      orderId: 'order-1',
    });
    await pending;
    expect(mockScheduleOrderProductBlogPurge).not.toHaveBeenCalled();
    expect(mockScheduleStorefrontHostnamePurge).not.toHaveBeenCalled();
  });

  it('falls back to a hostname purge when the order-item read rejects', async () => {
    const rejectingSupabase = makeRejectingItemsSupabase('ogabassey');
    let pending: Promise<unknown> | undefined;
    mockAfter.mockImplementationOnce((next: () => unknown) => {
      pending = Promise.resolve(next());
    });
    scheduleOrderBlogPurgeForOrderAfterResponse({
      supabase: rejectingSupabase as never,
      merchantId: 'merchant-1',
      orderId: 'order-1',
    });
    await pending;
    expect(mockScheduleOrderProductBlogPurge).not.toHaveBeenCalled();
    expect(mockScheduleStorefrontHostnamePurge).toHaveBeenCalledWith(
      'ogabassey'
    );
  });
});

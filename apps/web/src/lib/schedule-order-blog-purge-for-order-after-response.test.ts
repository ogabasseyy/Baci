import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAfter, mockScheduleOrderProductBlogPurge } = vi.hoisted(() => ({
  mockAfter: vi.fn(),
  mockScheduleOrderProductBlogPurge: vi.fn(),
}));

vi.mock('next/server', () => ({ after: mockAfter }));
vi.mock('./schedule-order-product-blog-purge', () => ({
  scheduleOrderProductBlogPurge: (...args: unknown[]) =>
    mockScheduleOrderProductBlogPurge(...args),
}));

import { scheduleOrderBlogPurgeForOrderAfterResponse } from './schedule-order-blog-purge-for-order-after-response';

function makeSupabase(result: { data: unknown; error: unknown }) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => Promise.resolve(result)),
  };
  return { from: vi.fn(() => builder) };
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

  it('does not schedule when the order has no product rows or the read fails', async () => {
    const emptySupabase = makeSupabase({ data: [], error: null });
    mockAfter.mockImplementationOnce((next: () => unknown) => next());
    scheduleOrderBlogPurgeForOrderAfterResponse({
      supabase: emptySupabase as never,
      merchantId: 'merchant-1',
      orderId: 'order-1',
    });
    await Promise.resolve();
    expect(mockScheduleOrderProductBlogPurge).not.toHaveBeenCalled();

    const failedSupabase = makeSupabase({
      data: null,
      error: new Error('read failed'),
    });
    mockAfter.mockImplementationOnce((next: () => unknown) => next());
    scheduleOrderBlogPurgeForOrderAfterResponse({
      supabase: failedSupabase as never,
      merchantId: 'merchant-1',
      orderId: 'order-1',
    });
    await Promise.resolve();
    expect(mockScheduleOrderProductBlogPurge).not.toHaveBeenCalled();
  });
});

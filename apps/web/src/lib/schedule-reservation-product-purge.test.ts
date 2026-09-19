import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ after: vi.fn(), purge: vi.fn() }));
vi.mock('next/server', () => ({ after: mocks.after }));
vi.mock('./schedule-order-product-blog-purge', () => ({
  scheduleOrderProductBlogPurge: mocks.purge,
}));

import { scheduleReservationProductPurge } from './schedule-reservation-product-purge';

describe('scheduleReservationProductPurge', () => {
  beforeEach(() => vi.clearAllMocks());
  it('defers and scopes quiz reservation invalidation', async () => {
    const source = 'quiz' as const;
    const result = {
      data: { settings: { prize_product_id: 'p1' } },
      error: null,
    };
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue(result),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const supabase = { from: vi.fn().mockReturnValue(query) };
    scheduleReservationProductPurge({
      source,
      sourceId: 'source-1',
      merchantId: 'merchant-1',
      supabase: supabase as never,
    });
    expect(supabase.from).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0][0]();
    expect(query.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(mocks.purge).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      productIds: ['p1'],
      supabase,
    });
  });
  it('does not turn a post-commit lookup failure into a mutation failure', async () => {
    const supabase = {
      from: vi.fn(() => {
        throw new Error('read failed');
      }),
    };
    scheduleReservationProductPurge({
      source: 'quiz',
      sourceId: 'q1',
      merchantId: 'm1',
      supabase: supabase as never,
    });
    await expect(mocks.after.mock.calls[0][0]()).resolves.toBeUndefined();
    expect(mocks.purge).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';

const { mockAfter, mockScheduleOrderProductBlogPurge } = vi.hoisted(() => ({
  mockAfter: vi.fn(),
  mockScheduleOrderProductBlogPurge: vi.fn(),
}));

vi.mock('next/server', () => ({ after: mockAfter }));
vi.mock('./schedule-order-product-blog-purge', () => ({
  scheduleOrderProductBlogPurge: (...args: unknown[]) =>
    mockScheduleOrderProductBlogPurge(...args),
}));

import { scheduleOrderProductBlogPurgeAfterResponse } from './schedule-order-product-blog-purge-after-response';

const input = {
  merchantId: 'merchant-1',
  merchantSlug: 'ogabassey',
  productIds: ['product-1'],
  supabase: {} as never,
};

describe('scheduleOrderProductBlogPurgeAfterResponse', () => {
  it('queues enrichment without running it before the response callback', async () => {
    let callback: (() => unknown) | undefined;
    mockAfter.mockImplementation((next: () => unknown) => {
      callback = next;
    });

    scheduleOrderProductBlogPurgeAfterResponse(input);

    expect(mockAfter).toHaveBeenCalledOnce();
    expect(mockScheduleOrderProductBlogPurge).not.toHaveBeenCalled();
    await callback?.();
    expect(mockScheduleOrderProductBlogPurge).toHaveBeenCalledWith(input);
  });

  it('detaches the best-effort helper when no request context exists', () => {
    mockAfter.mockImplementation(() => {
      throw new Error('outside request context');
    });

    scheduleOrderProductBlogPurgeAfterResponse(input);

    expect(mockScheduleOrderProductBlogPurge).toHaveBeenCalledWith(input);
  });
});

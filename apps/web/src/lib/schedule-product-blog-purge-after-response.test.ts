import { describe, expect, it, vi } from 'vitest';

const { mockAfter, mockScheduleProductBlogPurge } = vi.hoisted(() => ({
  mockAfter: vi.fn(),
  mockScheduleProductBlogPurge: vi.fn(),
}));

vi.mock('next/server', () => ({ after: mockAfter }));
vi.mock('./schedule-product-blog-purge', () => ({
  scheduleProductBlogPurge: (...args: unknown[]) =>
    mockScheduleProductBlogPurge(...args),
}));

import { scheduleProductBlogPurgeAfterResponse } from './schedule-product-blog-purge-after-response';

const input = {
  merchantId: 'merchant-1',
  merchantSlug: 'ogabassey',
  productIds: ['product-1'],
  entries: [{ slug: 'phone-1', categorySegment: 'smartphones' }],
  supabase: {} as never,
};

describe('scheduleProductBlogPurgeAfterResponse', () => {
  it('queues product article enrichment without running before response flush', async () => {
    let callback: (() => unknown) | undefined;
    mockAfter.mockImplementation((next: () => unknown) => {
      callback = next;
    });

    scheduleProductBlogPurgeAfterResponse(input);

    expect(mockAfter).toHaveBeenCalledOnce();
    expect(mockScheduleProductBlogPurge).not.toHaveBeenCalled();
    await callback?.();
    expect(mockScheduleProductBlogPurge).toHaveBeenCalledWith(input);
  });

  it('detaches the best-effort helper outside a request context', () => {
    mockAfter.mockImplementation(() => {
      throw new Error('outside request context');
    });

    scheduleProductBlogPurgeAfterResponse(input);

    expect(mockScheduleProductBlogPurge).toHaveBeenCalledWith(input);
  });
});

import { describe, expect, it, vi } from 'vitest';

const mockRevalidateProducts = vi.hoisted(() => vi.fn());
const mockSchedule = vi.hoisted(() => vi.fn());

vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProducts: (...args: unknown[]) => mockRevalidateProducts(...args),
}));
vi.mock('@/lib/schedule-order-blog-purge-for-order-after-response', () => ({
  scheduleOrderBlogPurgeForOrderAfterResponse: (...args: unknown[]) =>
    mockSchedule(...args),
}));

import { ensurePaidOrderInventoryConfirmed } from './ensure-paid-order-inventory-confirmed';

describe('ensurePaidOrderInventoryConfirmed article purge', () => {
  it('queues the related article purge after a serialized reservation is reclaimed', async () => {
    const mockSupabase = {
      rpc: vi.fn().mockResolvedValue({
        data: {
          alreadyConfirmed: 0,
          confirmedUnitCount: 0,
          reclaimedUnitCount: 1,
          missingUnitCount: 0,
          exceptionCodes: [],
        },
        error: null,
      }),
    };

    await ensurePaidOrderInventoryConfirmed(
      mockSupabase as unknown as Parameters<
        typeof ensurePaidOrderInventoryConfirmed
      >[0],
      'merchant-123',
      'order-123'
    );

    expect(mockRevalidateProducts).toHaveBeenCalledExactlyOnceWith(
      'merchant-123'
    );
    expect(mockSchedule).toHaveBeenCalledExactlyOnceWith({
      supabase: mockSupabase,
      merchantId: 'merchant-123',
      orderId: 'order-123',
    });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { clearOrderShipmentBookingLock } from '@/lib/shipping/order-shipment-booking-lock';
import { releaseDirectBookingLock } from './release-direct-booking-lock';

vi.mock('@/lib/shipping/order-shipment-booking-lock', () => ({
  clearOrderShipmentBookingLock: vi.fn(),
}));

describe('releaseDirectBookingLock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears the booking lock when one was acquired', async () => {
    const supabase = {} as never;

    await releaseDirectBookingLock(
      supabase,
      'merchant-1',
      'order-1',
      'lock-1',
      false
    );

    expect(clearOrderShipmentBookingLock).toHaveBeenCalledWith(
      supabase,
      'merchant-1',
      'order-1',
      'lock-1'
    );
  });

  it('skips cleanup when the provider attempt retained the lock', async () => {
    await releaseDirectBookingLock(
      {} as never,
      'merchant-1',
      'order-1',
      'lock-1',
      true
    );
    expect(clearOrderShipmentBookingLock).not.toHaveBeenCalled();
  });

  it('reports whether the lock was actually released', async () => {
    vi.mocked(clearOrderShipmentBookingLock).mockResolvedValueOnce(undefined);
    expect(
      await releaseDirectBookingLock({} as never, 'm', 'o', 'lock-1', false)
    ).toBe(true);
    vi.mocked(clearOrderShipmentBookingLock).mockRejectedValueOnce(
      new Error('db down')
    );
    expect(
      await releaseDirectBookingLock({} as never, 'm', 'o', 'lock-1', false)
    ).toBe(false);
    expect(
      await releaseDirectBookingLock({} as never, 'm', 'o', 'lock-1', true)
    ).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { shouldReleaseBookingLock } from '@/lib/shipping/order-shipment-booking-lock-errors';
import { requestTopshipPaymentAfterSave } from './topship-pay-after-save';

describe('requestTopshipPaymentAfterSave', () => {
  it('returns the response when the payment request succeeds', async () => {
    const response = new Response('{}');
    const result = await requestTopshipPaymentAfterSave({
      fetchPayment: async () => response,
      log: vi.fn(),
      trackingId: 'T1',
    });
    expect(result).toBe(response);
  });

  it('keeps the booking lock when a connection error follows the save', async () => {
    const log = vi.fn();
    const refused = Object.assign(new Error('connect failed'), {
      code: 'ECONNREFUSED',
    });
    const failure = await requestTopshipPaymentAfterSave({
      fetchPayment: async () => {
        throw refused;
      },
      log,
      trackingId: 'T1',
    }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('tracking T1');
    expect((failure as Error).cause).toBeUndefined();
    expect(shouldReleaseBookingLock(failure)).toBe(false);
    expect(log).toHaveBeenCalledWith(
      'error',
      'Topship payment request failed after save',
      expect.objectContaining({ trackingId: 'T1', errorCode: 'ECONNREFUSED' })
    );
  });
});

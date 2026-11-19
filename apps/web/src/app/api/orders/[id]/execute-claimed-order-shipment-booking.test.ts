import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/shipping/run-claimed-order-wallet-or-checkout-booking', () => ({
  runClaimedOrderWalletOrCheckoutBooking: vi.fn(),
}));

vi.mock('@/lib/shipping/order-shipment-booking-lock', () => ({
  clearOrderShipmentBookingLock: vi.fn(),
}));

vi.mock('@/lib/shipping/order-shipment-booking-failure', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/shipping/order-shipment-booking-failure')
  >('@/lib/shipping/order-shipment-booking-failure');
  return {
    ...actual,
    recordOrderShipmentBookingFailure: vi.fn(),
  };
});

import { recordOrderShipmentBookingFailure } from '@/lib/shipping/order-shipment-booking-failure';
import { clearOrderShipmentBookingLock } from '@/lib/shipping/order-shipment-booking-lock';
import { runClaimedOrderWalletOrCheckoutBooking } from '@/lib/shipping/run-claimed-order-wallet-or-checkout-booking';
import { executeClaimedOrderShipmentBooking } from './execute-claimed-order-shipment-booking';

const supabase = {} as unknown as SupabaseClient;
const existingOrder = {
  selected_quote_id: 'quote-1',
  shipping_funding_source: 'merchant_wallet' as const,
  shipping_provider: 'GIGL',
  payment_status: 'paid',
  payment_method: 'card',
};

describe('executeClaimedOrderShipmentBooking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips duplicate lock clearing and records lock_retained=false when booking already released the lock', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(runClaimedOrderWalletOrCheckoutBooking).mockImplementationOnce(
      async (_supabase, _merchantId, _orderId, _order, options) => {
        options?.onLockReleased?.();
        throw new Error('MERCHANT_WALLET_SUBMISSION_FAILED');
      }
    );

    await expect(
      executeClaimedOrderShipmentBooking({
        supabase,
        merchantId: 'merchant-1',
        orderId: 'order-1',
        existingOrder,
        paymentStatus: 'paid',
        lockToken: 'lock-1',
      })
    ).rejects.toThrow();

    expect(clearOrderShipmentBookingLock).not.toHaveBeenCalled();
    expect(recordOrderShipmentBookingFailure).toHaveBeenCalledWith(
      supabase,
      'merchant-1',
      'order-1',
      expect.any(Error),
      false
    );
  });

  it('bugfix: does not promise a 15-minute pause on an unconfirmed timeout when the lock was already freed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(runClaimedOrderWalletOrCheckoutBooking).mockImplementationOnce(
      async (_supabase, _merchantId, _orderId, _order, options) => {
        options?.onLockReleased?.();
        throw new Error('GIGL booking timed out');
      }
    );

    const error = await executeClaimedOrderShipmentBooking({
      supabase,
      merchantId: 'merchant-1',
      orderId: 'order-1',
      existingOrder: {
        ...existingOrder,
        shipping_funding_source: 'customer_paid' as never,
      },
      paymentStatus: 'paid',
      lockToken: 'lock-1',
    }).catch((e: unknown) => e);

    expect((error as Error).message).not.toMatch(/15 minutes/);
    expect((error as Error).message).toMatch(/check with the carrier/);
  });
});

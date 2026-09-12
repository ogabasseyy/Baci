import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleRepairPickupPayment } from './handle-repair-pickup-payment';
import {
  createRepairPickupPaymentMetadata,
  createRepairPickupPaymentSupabase,
  repairPickupPaymentTestMerchantId,
  repairPickupPaymentTestReference,
  repairPickupPaymentTestRepairId,
  repairPickupPaymentTestSecret,
} from './handle-repair-pickup-payment.test-support';

const mocks = vi.hoisted(() => ({ bookRepairPickup: vi.fn() }));

vi.mock('@/lib/repairs/book-repair-pickup', () => ({
  bookRepairPickup: mocks.bookRepairPickup,
}));

vi.mock('@/lib/repairs/notify-repair-pickup-booking', () => ({
  notifyRepairPickupBookingAfterPayment: vi.fn().mockResolvedValue(undefined),
}));

describe('handleRepairPickupPayment conflict and claim mismatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PAYSTACK_SECRET_KEY = repairPickupPaymentTestSecret;
    mocks.bookRepairPickup.mockResolvedValue({
      ok: true,
      carrierName: 'GIG Logistics',
      pickupScheduledAt: null,
      shipmentId: 'shipment-1',
      trackingNumber: '1349000000',
    });
  });

  it('bugfix: invalid claim with unsigned victim ids does not ledger mismatch', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const victimMerchantId = '999e4567-e89b-12d3-a456-426614174000';
    const victimRepairId = '888e4567-e89b-12d3-a456-426614174000';
    const { client, from, rpc } = createRepairPickupPaymentSupabase();
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const serviceEq = vi.fn().mockReturnValue({ maybeSingle });
    const referenceEq = vi.fn().mockReturnValue({
      eq: serviceEq,
      maybeSingle,
    });
    const select = vi.fn().mockReturnValue({ eq: referenceEq });
    from.mockReturnValue({ select, update: vi.fn() });

    try {
      const result = await handleRepairPickupPayment({
        gateway: 'paystack',
        gatewayResponse: {
          currency: 'NGN',
          metadata: {
            transaction_type: 'repair_pickup',
            merchant_id: victimMerchantId,
            repair_id: victimRepairId,
            pickup_claim_signature: 'invalid',
          },
        },
        reference: repairPickupPaymentTestReference,
        supabase: client,
        verifiedAmount: 8250,
      });

      expect(result).toEqual({
        handled: true,
        status: 200,
        body: { message: 'Repair pickup payment mismatch ignored (unbound)' },
      });
      expect(rpc).not.toHaveBeenCalled();
      expect(from).toHaveBeenCalledWith('repairs');
      expect(from).toHaveBeenCalledWith(
        'repair_pickup_pending_payment_references'
      );
      expect(mocks.bookRepairPickup).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('bug fix: retrying paid repair after claim verify fails still books', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client, from, rpc } = createRepairPickupPaymentSupabase();
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: repairPickupPaymentTestRepairId,
        merchant_id: repairPickupPaymentTestMerchantId,
        pickup_currency: 'NGN',
        pickup_fee: 8250,
        pickup_payment_status: 'retrying',
      },
      error: null,
    });
    const serviceEq = vi.fn().mockReturnValue({ maybeSingle });
    const referenceEq = vi.fn().mockReturnValue({ eq: serviceEq });
    const select = vi.fn().mockReturnValue({ eq: referenceEq });
    from.mockReturnValue({ select, update: vi.fn() });

    try {
      process.env.PAYSTACK_SECRET_KEY = 'rotated-paystack-secret';
      const result = await handleRepairPickupPayment({
        gateway: 'paystack',
        gatewayResponse: {
          currency: 'NGN',
          metadata: createRepairPickupPaymentMetadata(),
        },
        reference: repairPickupPaymentTestReference,
        supabase: client,
        verifiedAmount: 8250,
      });

      expect(result).toEqual({
        handled: true,
        status: 200,
        body: {
          message: 'Repair pickup payment confirmed and shipment booked',
          trackingNumber: '1349000000',
        },
      });
      expect(rpc).not.toHaveBeenCalled();
      expect(from).toHaveBeenCalledWith('repairs');
      expect(mocks.bookRepairPickup).toHaveBeenCalledWith(
        client,
        repairPickupPaymentTestMerchantId,
        repairPickupPaymentTestRepairId
      );
    } finally {
      process.env.PAYSTACK_SECRET_KEY = repairPickupPaymentTestSecret;
      consoleSpy.mockRestore();
    }
  });
});

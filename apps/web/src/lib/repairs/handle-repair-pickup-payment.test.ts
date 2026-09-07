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

describe('handleRepairPickupPayment claim confirmation', () => {
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

  it('ignores verified payments that are not repair pickups', async () => {
    const { client, rpc } = createRepairPickupPaymentSupabase();

    const result = await handleRepairPickupPayment({
      gateway: 'paystack',
      gatewayResponse: { currency: 'NGN', metadata: {} },
      reference: repairPickupPaymentTestReference,
      supabase: client,
      verifiedAmount: 8250,
    });

    expect(result).toEqual({ handled: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('confirms payment before booking the pickup exactly once', async () => {
    const { client, rpc } = createRepairPickupPaymentSupabase();

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
    expect(rpc).toHaveBeenCalledWith('confirm_repair_pickup_payment', {
      p_amount: 8250,
      p_currency: 'NGN',
      p_gateway_response: expect.objectContaining({ currency: 'NGN' }),
      p_merchant_id: repairPickupPaymentTestMerchantId,
      p_reference: repairPickupPaymentTestReference,
      p_repair_id: repairPickupPaymentTestRepairId,
    });
    expect(mocks.bookRepairPickup).toHaveBeenCalledOnce();
  });

  it('ledgers a tampered payment amount before ACKing for review', async () => {
    const { client, rpc } = createRepairPickupPaymentSupabase();
    rpc.mockResolvedValueOnce({ data: [{ recorded: true }], error: null });

    const result = await handleRepairPickupPayment({
      gateway: 'paystack',
      gatewayResponse: {
        currency: 'NGN',
        metadata: createRepairPickupPaymentMetadata(),
      },
      reference: repairPickupPaymentTestReference,
      supabase: client,
      verifiedAmount: 8000,
    });

    expect(result).toEqual({
      handled: true,
      status: 200,
      body: { message: 'Repair pickup payment requires review' },
    });
    expect(rpc).toHaveBeenCalledWith('record_repair_pickup_payment_mismatch', {
      p_amount: 8000,
      p_currency: 'NGN',
      p_gateway_response: expect.objectContaining({ currency: 'NGN' }),
      p_merchant_id: repairPickupPaymentTestMerchantId,
      p_mismatch_reason: 'amount_mismatch',
      p_reference: repairPickupPaymentTestReference,
      p_repair_id: repairPickupPaymentTestRepairId,
    });
    expect(rpc).not.toHaveBeenCalledWith(
      'confirm_repair_pickup_payment',
      expect.anything()
    );
    expect(mocks.bookRepairPickup).not.toHaveBeenCalled();
  });

  it('asks Paystack to retry when mismatch ledger persistence fails', async () => {
    const { client, rpc } = createRepairPickupPaymentSupabase();
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });

    const result = await handleRepairPickupPayment({
      gateway: 'paystack',
      gatewayResponse: {
        currency: 'NGN',
        metadata: createRepairPickupPaymentMetadata(),
      },
      reference: repairPickupPaymentTestReference,
      supabase: client,
      verifiedAmount: 8000,
    });

    expect(result).toEqual({
      handled: true,
      status: 503,
      body: {
        message: 'Repair pickup payment mismatch will retry until durable',
      },
    });
    expect(mocks.bookRepairPickup).not.toHaveBeenCalled();
  });

  it('asks Paystack to retry when atomic payment confirmation fails', async () => {
    const { client, rpc } = createRepairPickupPaymentSupabase();
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });

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

    expect(result).toMatchObject({ handled: true, status: 503 });
    expect(mocks.bookRepairPickup).not.toHaveBeenCalled();
  });

  it('reuses the confirmed repair on a duplicate webhook', async () => {
    const { client } = createRepairPickupPaymentSupabase(false);
    mocks.bookRepairPickup.mockResolvedValueOnce({
      ok: false,
      reason: 'already_booked',
      message: 'Already booked',
      canRetryManually: false,
    });

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
      body: { message: 'Repair pickup payment already processed' },
    });
    expect(mocks.bookRepairPickup).toHaveBeenCalledOnce();
  });
});

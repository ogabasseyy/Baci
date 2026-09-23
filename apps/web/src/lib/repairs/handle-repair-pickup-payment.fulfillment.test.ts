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

const mocks = vi.hoisted(() => ({
  bookRepairPickup: vi.fn(),
  notifyRepairPickupBookingAfterPayment: vi.fn(),
}));

vi.mock('@/lib/repairs/book-repair-pickup', () => ({
  bookRepairPickup: mocks.bookRepairPickup,
}));

vi.mock('@/lib/repairs/notify-repair-pickup-booking', () => ({
  notifyRepairPickupBookingAfterPayment:
    mocks.notifyRepairPickupBookingAfterPayment,
}));

describe('handleRepairPickupPayment fulfillment outcomes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PAYSTACK_SECRET_KEY = repairPickupPaymentTestSecret;
    mocks.notifyRepairPickupBookingAfterPayment.mockResolvedValue(undefined);
  });

  it('marks an ambiguous provider result for review without retrying the webhook', async () => {
    const {
      client,
      firstEq,
      secondEq,
      thirdEq,
      bookedNeq,
      reviewNeq,
      manualNeq,
      update,
    } = createRepairPickupPaymentSupabase();
    mocks.bookRepairPickup.mockResolvedValueOnce({
      ok: false,
      reason: 'shipment_save_failed',
      message: 'Shipment persistence is ambiguous',
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
      body: {
        message: 'Repair pickup payment confirmed; shipment requires review',
      },
    });
    expect(update).toHaveBeenCalledWith({ pickup_payment_status: 'review' });
    expect(firstEq).toHaveBeenCalledWith('id', repairPickupPaymentTestRepairId);
    expect(secondEq).toHaveBeenCalledWith(
      'merchant_id',
      repairPickupPaymentTestMerchantId
    );
    expect(thirdEq).toHaveBeenCalledWith(
      'pickup_payment_reference',
      repairPickupPaymentTestReference
    );
    expect(bookedNeq).toHaveBeenCalledWith('pickup_payment_status', 'booked');
    expect(reviewNeq).toHaveBeenCalledWith('pickup_payment_status', 'review');
    expect(manualNeq).toHaveBeenCalledWith(
      'pickup_payment_status',
      'manual_fulfilled'
    );
    expect(mocks.notifyRepairPickupBookingAfterPayment).toHaveBeenCalledWith(
      client,
      repairPickupPaymentTestMerchantId,
      repairPickupPaymentTestRepairId
    );
  });

  it('marks carrier availability failures retrying and asks Paystack to retry', async () => {
    const { client, update } = createRepairPickupPaymentSupabase();
    mocks.bookRepairPickup.mockResolvedValueOnce({
      ok: false,
      reason: 'gigl_unavailable',
      message: 'GIGL temporarily unavailable',
      canRetryManually: true,
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

    expect(result).toMatchObject({ handled: true, status: 503 });
    expect(update).toHaveBeenCalledWith({ pickup_payment_status: 'retrying' });
    expect(mocks.notifyRepairPickupBookingAfterPayment).not.toHaveBeenCalled();
  });

  it('asks Paystack to retry when local shipment insert fails before booking', async () => {
    const { client, update } = createRepairPickupPaymentSupabase();
    mocks.bookRepairPickup.mockResolvedValueOnce({
      ok: false,
      reason: 'booking_failed',
      message: 'Shipment insert failed before GIGL booking',
      canRetryManually: true,
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

    expect(result).toMatchObject({ handled: true, status: 503 });
    expect(update).toHaveBeenCalledWith({ pickup_payment_status: 'retrying' });
  });

  it('asks Paystack to retry when post-payment repair lookup fails transiently', async () => {
    const { client, update } = createRepairPickupPaymentSupabase();
    mocks.bookRepairPickup.mockResolvedValueOnce({
      ok: false,
      reason: 'lookup_failed',
      message:
        'Could not load this repair booking right now. Payment is safe — please retry shortly.',
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

    expect(result).toMatchObject({ handled: true, status: 503 });
    expect(update).toHaveBeenCalledWith({ pickup_payment_status: 'retrying' });
  });

  it('does not ask Paystack to retry definitive GIGL booking rejections', async () => {
    const { client, update, bookedNeq, reviewNeq, manualNeq } =
      createRepairPickupPaymentSupabase();
    mocks.bookRepairPickup.mockResolvedValueOnce({
      ok: false,
      reason: 'provider_rejected',
      message: 'GIGL rejected the pickup',
      canRetryManually: true,
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

    expect(result).toMatchObject({
      handled: true,
      status: 200,
      body: {
        message: 'Repair pickup payment confirmed; shipment requires review',
      },
    });
    expect(update).toHaveBeenCalledWith({ pickup_payment_status: 'review' });
    expect(bookedNeq).toHaveBeenCalledWith('pickup_payment_status', 'booked');
    expect(reviewNeq).toHaveBeenCalledWith('pickup_payment_status', 'review');
    expect(manualNeq).toHaveBeenCalledWith(
      'pickup_payment_status',
      'manual_fulfilled'
    );
    expect(mocks.notifyRepairPickupBookingAfterPayment).toHaveBeenCalledWith(
      client,
      repairPickupPaymentTestMerchantId,
      repairPickupPaymentTestRepairId
    );
  });

  it('asks Paystack to retry when definitive failure review state cannot be persisted', async () => {
    const { client, manualNeq } = createRepairPickupPaymentSupabase();
    manualNeq.mockResolvedValueOnce({ error: { message: 'write failed' } });
    mocks.bookRepairPickup.mockResolvedValueOnce({
      ok: false,
      reason: 'quote_increased',
      message: 'Quote increased',
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

    expect(result).toMatchObject({
      handled: true,
      status: 503,
      body: {
        message:
          'Repair pickup payment confirmed; review state persistence will retry',
      },
    });
    expect(mocks.notifyRepairPickupBookingAfterPayment).not.toHaveBeenCalled();
  });

  it('ACKs without rebooking after merchant payment-side review', async () => {
    const { client } = createRepairPickupPaymentSupabase({
      confirmed: false,
      pickupPaymentStatus: 'review',
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
      body: {
        message: 'Repair pickup payment confirmed; shipment requires review',
      },
    });
    expect(mocks.bookRepairPickup).not.toHaveBeenCalled();
    expect(mocks.notifyRepairPickupBookingAfterPayment).not.toHaveBeenCalled();
  });

  it('ACKs without rebooking after merchant manual fulfillment', async () => {
    const { client } = createRepairPickupPaymentSupabase({
      confirmed: false,
      pickupPaymentStatus: 'manual_fulfilled',
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
      body: {
        message:
          'Repair pickup payment confirmed; merchant arranged pickup manually',
      },
    });
    expect(mocks.bookRepairPickup).not.toHaveBeenCalled();
    expect(mocks.notifyRepairPickupBookingAfterPayment).not.toHaveBeenCalled();
  });
});

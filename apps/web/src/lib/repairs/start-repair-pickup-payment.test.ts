import { beforeEach, describe, expect, it } from 'vitest';
import './start-repair-pickup-payment.test-support';
import { repairPickupPaymentClaims } from './repair-pickup-payment-claim';
import { startRepairPickupPayment } from './start-repair-pickup-payment';
import {
  arrangeStartRepairPickupPayment,
  getStartRepairPickupPaymentMocks,
  startRepairPickupPaymentInput,
  startRepairPickupPaymentMerchantId,
  startRepairPickupPaymentRepairId,
} from './start-repair-pickup-payment.test-support';

const mocks = getStartRepairPickupPaymentMocks();
const input = startRepairPickupPaymentInput;
const merchantId = startRepairPickupPaymentMerchantId;
const repairId = startRepairPickupPaymentRepairId;

describe('startRepairPickupPayment', () => {
  beforeEach(arrangeStartRepairPickupPayment);

  it('does not call GIGL or create payment when the public action is rate limited', async () => {
    mocks.ensureActionRateLimit.mockResolvedValueOnce(false);

    const result = await startRepairPickupPayment({
      data: input,
      expectedPickupFee: 8250,
      merchantId,
      merchantIdentifier: 'ogabassey',
    });

    expect(result).toMatchObject({
      success: false,
      code: 'rate_limited',
    });
    expect(mocks.quoteRepairPickup).not.toHaveBeenCalled();
    expect(mocks.createRepairBooking).not.toHaveBeenCalled();
    expect(mocks.initializeTransaction).not.toHaveBeenCalled();
  });

  it('creates a pending repair and initializes the exact quoted pickup payment', async () => {
    const result = await startRepairPickupPayment({
      data: input,
      expectedPickupFee: 8250,
      merchantId,
      merchantIdentifier: 'ogabassey',
    });

    expect(result).toMatchObject({
      success: true,
      id: repairId,
      ticketNumber: 42,
      payment: {
        amount: 8250,
        authorizationUrl: 'https://checkout.paystack.com/access-code',
      },
    });
    expect(mocks.resolveRepairPickupPaymentMerchant).toHaveBeenCalledWith({
      merchantId,
      merchantSlug: 'ogabassey',
      supabase: expect.anything(),
    });
    expect(mocks.markRepairPickupAwaitingPayment).toHaveBeenCalledWith({
      merchantId,
      repairId,
    });
    expect(mocks.bindRepairPickupPendingPaymentReference).toHaveBeenCalledWith({
      merchantId,
      repairId,
      reference: expect.stringMatching(/^RPU-[A-Z0-9]{16}$/),
    });
    const initPayload = mocks.initializeTransaction.mock.calls[0]?.[0];
    expect(
      mocks.bindRepairPickupPendingPaymentReference.mock.calls[0]?.[0]
    ).toEqual(
      expect.objectContaining({
        reference: initPayload.reference,
      })
    );
    expect(initPayload.amount).toBe(825_000);
    expect(initPayload.email).toBe('ada@example.com');
    expect(initPayload.callback_url).toBe(
      'http://ogabassey.usebaci.com/repair/status?ticket=42'
    );
    expect(
      repairPickupPaymentClaims.verify(
        initPayload.metadata,
        'paystack-secret-for-tests'
      )
    ).toEqual({
      amountKobo: 825_000,
      currency: 'NGN',
      merchantId,
      reference: initPayload.reference,
      repairId,
    });
  });

  it('does not create a repair or charge when the live pickup price changed', async () => {
    const result = await startRepairPickupPayment({
      data: input,
      expectedPickupFee: 8000,
      merchantId,
      merchantIdentifier: 'ogabassey',
    });

    expect(result).toEqual({
      success: false,
      code: 'quote_changed',
      error: 'The pickup price changed. Review the new price before paying.',
      quote: { formattedPrice: '₦8,250', price: 8250 },
    });
    expect(mocks.createRepairBooking).not.toHaveBeenCalled();
    expect(mocks.initializeTransaction).not.toHaveBeenCalled();
  });

  it('fails closed when the repairs catalogue is disabled', async () => {
    mocks.resolveRepairPickupPaymentMerchant.mockResolvedValueOnce(null);

    const result = await startRepairPickupPayment({
      data: input,
      expectedPickupFee: 8250,
      merchantId,
      merchantIdentifier: 'ogabassey',
    });

    expect(result).toEqual({
      success: false,
      code: 'not_found',
      error: 'Store not found.',
    });
    expect(mocks.quoteRepairPickup).not.toHaveBeenCalled();
    expect(mocks.createRepairBooking).not.toHaveBeenCalled();
    expect(mocks.initializeTransaction).not.toHaveBeenCalled();
  });

  it('does not create an orphan repair when Paystack is not configured', async () => {
    delete process.env.PAYSTACK_SECRET_KEY;

    const result = await startRepairPickupPayment({
      data: input,
      expectedPickupFee: 8250,
      merchantId,
      merchantIdentifier: 'ogabassey',
    });

    expect(result).toMatchObject({
      success: false,
      code: 'payment_initialization_failed',
    });
    expect(mocks.createRepairBooking).not.toHaveBeenCalled();
    expect(mocks.initializeTransaction).not.toHaveBeenCalled();
  });

  it('returns the created ticket when Paystack initialization fails', async () => {
    mocks.initializeTransaction.mockRejectedValueOnce(
      new Error('Paystack unavailable')
    );

    const result = await startRepairPickupPayment({
      data: input,
      expectedPickupFee: 8250,
      merchantId,
      merchantIdentifier: 'ogabassey',
    });

    expect(result).toMatchObject({
      success: false,
      code: 'payment_initialization_failed',
      error:
        'Your repair request was saved, but payment could not start. Use your ticket to retry shortly.',
      id: repairId,
      ticketNumber: 42,
    });
    expect(result).toHaveProperty('resumeToken');
    expect(mocks.markRepairPickupAwaitingPayment).toHaveBeenCalledWith({
      merchantId,
      repairId,
    });
  });

  it('does not initialize Paystack when awaiting_payment cannot be marked', async () => {
    mocks.markRepairPickupAwaitingPayment.mockResolvedValueOnce({
      ok: false,
      error:
        'We could not prepare pickup payment for this request. Please try again shortly.',
    });

    const result = await startRepairPickupPayment({
      data: input,
      expectedPickupFee: 8250,
      merchantId,
      merchantIdentifier: 'ogabassey',
    });

    expect(result).toMatchObject({
      success: false,
      code: 'payment_initialization_failed',
      id: repairId,
      ticketNumber: 42,
    });
    // Create already persists awaiting_payment atomically; mark is reinforcement.
    expect(mocks.createRepairBooking).toHaveBeenCalledWith(input, merchantId);
    expect(
      mocks.bindRepairPickupPendingPaymentReference
    ).not.toHaveBeenCalled();
    expect(mocks.initializeTransaction).not.toHaveBeenCalled();
  });

  it('does not initialize Paystack when the pending reference cannot be bound', async () => {
    mocks.bindRepairPickupPendingPaymentReference.mockResolvedValueOnce({
      ok: false,
      error:
        'We could not prepare pickup payment for this request. Please try again shortly.',
    });

    const result = await startRepairPickupPayment({
      data: input,
      expectedPickupFee: 8250,
      merchantId,
      merchantIdentifier: 'ogabassey',
    });

    expect(result).toMatchObject({
      success: false,
      code: 'payment_initialization_failed',
      id: repairId,
      ticketNumber: 42,
    });
    expect(mocks.bindRepairPickupPendingPaymentReference).toHaveBeenCalled();
    expect(mocks.initializeTransaction).not.toHaveBeenCalled();
  });

  it('returns pickup_unavailable when the live quote request throws', async () => {
    mocks.quoteRepairPickup.mockRejectedValueOnce(new Error('GIGL offline'));

    const result = await startRepairPickupPayment({
      data: input,
      expectedPickupFee: 8250,
      merchantId,
      merchantIdentifier: 'ogabassey',
    });

    expect(result).toEqual({
      success: false,
      code: 'pickup_unavailable',
      error: 'Courier pickup is not available for this address.',
    });
    expect(mocks.createRepairBooking).not.toHaveBeenCalled();
    expect(mocks.initializeTransaction).not.toHaveBeenCalled();
  });

  it('bugfix: refuses separator-padded phones before taking payment', async () => {
    const result = await startRepairPickupPayment({
      data: { ...input, customerPhone: '0803------' },
      expectedPickupFee: 8250,
      merchantId,
      merchantIdentifier: 'ogabassey',
    });

    expect(result).toEqual({
      success: false,
      code: 'validation_failed',
      error: 'Enter a valid phone number with at least 10 digits.',
    });
    expect(mocks.quoteRepairPickup).not.toHaveBeenCalled();
    expect(mocks.initializeTransaction).not.toHaveBeenCalled();
  });
});

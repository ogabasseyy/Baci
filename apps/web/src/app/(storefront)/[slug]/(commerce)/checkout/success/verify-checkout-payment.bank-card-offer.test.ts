import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyCheckoutPayment } from './verify-checkout-payment';
import { handlers, params } from './verify-checkout-payment.test-support';

const request = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: request }));

describe('verifyCheckoutPayment bank card offer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('binds bank-offer verification to the storefront and leaves a missing order number blank', async () => {
    const reference = `BCO-${'a'.repeat(32)}`;
    request.mockResolvedValue(
      Response.json({ status: 'pending' }, { status: 202 })
    );
    const callbacks = handlers();

    await verifyCheckoutPayment({ ...params, reference }, callbacks);

    expect(request).toHaveBeenCalledWith(
      '/api/payments/verify',
      expect.objectContaining({
        body: JSON.stringify({ reference, merchantSlug: params.merchantSlug }),
      })
    );
    expect(callbacks.setOrderNumber).not.toHaveBeenCalled();
  });

  it('stops polling a denied bank-offer request without prompting a new payment', async () => {
    request.mockResolvedValue(
      Response.json(
        {
          error: 'Verification unavailable',
          code: 'BANK_CARD_OFFER_VERIFICATION_DENIED',
        },
        { status: 403 }
      )
    );
    const callbacks = handlers();

    await verifyCheckoutPayment(
      { ...params, reference: `BCO-${'a'.repeat(32)}` },
      callbacks
    );

    expect(callbacks.setStatus).toHaveBeenCalledWith('access_required');
    expect(callbacks.setOrderNumber).toHaveBeenCalledWith(null);
    expect(callbacks.scheduleFailedRedirect).not.toHaveBeenCalled();
    expect(callbacks.capturePaymentFailed).not.toHaveBeenCalled();
  });

  it('keeps a bank offer pending during a verification server outage', async () => {
    request.mockResolvedValue(
      Response.json({ error: 'Verification unavailable' }, { status: 503 })
    );
    const callbacks = handlers();

    await verifyCheckoutPayment(
      { ...params, reference: `BCO-${'a'.repeat(32)}` },
      callbacks
    );

    expect(callbacks.setStatus).toHaveBeenCalledWith('pending', 15_000);
    expect(callbacks.setOrderNumber).not.toHaveBeenCalled();
    expect(callbacks.capturePaymentFailed).not.toHaveBeenCalled();
    expect(callbacks.scheduleFailedRedirect).not.toHaveBeenCalled();
  });

  it.each([
    429, 503,
  ])('honors Retry-After on HTTP %s even with a non-JSON body', async (status) => {
    request.mockResolvedValue(
      new Response('Temporary gateway error', {
        status,
        headers: { 'Retry-After': '30' },
      })
    );
    const callbacks = handlers();

    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await verifyCheckoutPayment(
        { ...params, reference: `BCO-${'a'.repeat(32)}` },
        callbacks
      );

      expect(warning).toHaveBeenCalledWith(
        'Bank card offer verification returned invalid JSON',
        { status }
      );
      expect(callbacks.setStatus).toHaveBeenCalledWith('pending', 30_000);
      expect(callbacks.capturePaymentFailed).not.toHaveBeenCalled();
      expect(callbacks.scheduleFailedRedirect).not.toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });

  it.each([
    400, 404, 409,
  ])('never prompts a second payment after bank-offer verification HTTP %s', async (status) => {
    request.mockResolvedValue(
      Response.json({}, { status, headers: { 'Retry-After': '30' } })
    );
    const callbacks = handlers();

    await verifyCheckoutPayment(
      { ...params, reference: `BCO-${'a'.repeat(32)}` },
      callbacks
    );

    expect(callbacks.setStatus).toHaveBeenCalledWith(
      'verification_unavailable'
    );
    expect(callbacks.capturePaymentFailed).not.toHaveBeenCalled();
    expect(callbacks.scheduleFailedRedirect).not.toHaveBeenCalled();
    expect(callbacks.setOrderNumber).not.toHaveBeenCalled();
  });

  it('offers a safe refresh if bank-offer verification fails after the CSRF retry', async () => {
    request.mockResolvedValue(
      Response.json({ error: 'Invalid CSRF token' }, { status: 403 })
    );
    const callbacks = handlers();

    await verifyCheckoutPayment(
      { ...params, reference: `BCO-${'a'.repeat(32)}` },
      callbacks
    );

    expect(callbacks.setStatus).toHaveBeenCalledWith(
      'verification_unavailable'
    );
    expect(callbacks.setOrderNumber).not.toHaveBeenCalled();
    expect(callbacks.capturePaymentFailed).not.toHaveBeenCalled();
    expect(callbacks.scheduleFailedRedirect).not.toHaveBeenCalled();
  });

  it.each([
    'failed',
    'cancelled',
    'abandoned',
  ])('shows review for a bank-offer attempt reported %s', async (status) => {
    request.mockResolvedValue(
      Response.json({ success: false, status, orderNumber: 'ORD-1' })
    );
    const callbacks = handlers();

    await verifyCheckoutPayment(
      { ...params, reference: `BCO-${'a'.repeat(32)}` },
      callbacks
    );

    expect(callbacks.setStatus).toHaveBeenCalledWith('bank_offer_review');
    expect(callbacks.setOrderNumber).toHaveBeenCalledWith('ORD-1');
    expect(callbacks.scheduleFailedRedirect).not.toHaveBeenCalled();
    expect(callbacks.capturePaymentFailed).not.toHaveBeenCalled();
    expect(callbacks.clearCart).not.toHaveBeenCalled();
  });

  it.each([
    `BCO-${'a'.repeat(32)}`,
    `bco-${'A'.repeat(32)}`,
  ])('shows reconciliation for a reversed bank-offer payment (%s)', async (reference) => {
    request.mockResolvedValue(
      Response.json({
        success: false,
        status: 'reversed',
        orderNumber: 'ORD-1',
      })
    );
    const callbacks = handlers();

    await verifyCheckoutPayment({ ...params, reference }, callbacks);

    expect(request).toHaveBeenCalledWith(
      '/api/payments/verify',
      expect.objectContaining({
        body: JSON.stringify({
          reference: `BCO-${'a'.repeat(32)}`,
          merchantSlug: params.merchantSlug,
        }),
      })
    );

    expect(callbacks.setStatus).toHaveBeenCalledWith('reversed');
    expect(callbacks.setOrderNumber).toHaveBeenCalledWith('ORD-1');
    expect(callbacks.clearCart).not.toHaveBeenCalled();
    expect(callbacks.capturePaymentFailed).not.toHaveBeenCalled();
    expect(callbacks.scheduleFailedRedirect).not.toHaveBeenCalled();
  });

  it.each([
    'standard-reference',
    'BCO-invalid',
  ])('leaves reversal pending when %s is not a valid bank-offer reference', async (reference) => {
    request.mockResolvedValue(
      Response.json({ success: false, status: 'reversed' })
    );
    const callbacks = handlers();

    await verifyCheckoutPayment({ ...params, reference }, callbacks);

    expect(callbacks.setStatus).toHaveBeenCalledWith('pending');
    expect(callbacks.capturePaymentFailed).not.toHaveBeenCalled();
    expect(callbacks.scheduleFailedRedirect).not.toHaveBeenCalled();
  });
});

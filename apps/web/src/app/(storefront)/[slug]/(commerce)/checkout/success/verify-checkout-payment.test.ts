import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyCheckoutPayment } from './verify-checkout-payment';

const request = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: request }));

function handlers() {
  return {
    capturePaymentCompleted: vi.fn(),
    capturePaymentFailed: vi.fn(),
    clearCart: vi.fn(),
    redirectToCheckout: vi.fn(),
    scheduleFailedRedirect: vi.fn(),
    setIsVerifying: vi.fn(),
    setOrderNumber: vi.fn(),
    setPaymentMethod: vi.fn(),
    setStatus: vi.fn(),
  };
}

const params = {
  merchantSlug: 'ogabassey',
  orderId: 'order-id',
  paymentMethod: null,
  pendingRedvaultOrder: false,
  reference: null,
  trackingToken: null,
};

describe('verifyCheckoutPayment', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    'unpaid',
    'pending',
    'failed',
    undefined,
  ])('fails closed on a known REDVAULT order even without an order number: %s', async (paymentStatus) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          payment_method: 'uba_redvault',
          payment_status: paymentStatus,
        })
      )
    );
    const callbacks = handlers();

    await verifyCheckoutPayment(params, callbacks);

    expect(callbacks.clearCart).not.toHaveBeenCalled();
    expect(callbacks.setStatus).toHaveBeenCalledWith('pending');
    expect(callbacks.setIsVerifying).toHaveBeenLastCalledWith(false);
  });

  it.each([
    'uba_redvault',
    'invoice',
    'pay_on_delivery',
  ])('preserves confirmed paid or offline order behavior for %s', async (method) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          payment_method: method,
          payment_status: method === 'uba_redvault' ? 'paid' : 'unpaid',
          order_number: 'ORD-1',
        })
      )
    );
    const callbacks = handlers();

    await verifyCheckoutPayment(params, callbacks);

    expect(callbacks.clearCart).toHaveBeenCalledOnce();
    expect(callbacks.setStatus).toHaveBeenCalledWith('success');
  });

  it.each([
    'REDVAULT_CAPTURE_HELD',
    'REDVAULT_CAPTURE_EVIDENCE_REVIEW',
    'REDVAULT_RECONCILIATION_REQUIRED',
  ])('does not let a success flag override the held/pending code %s', async (code) => {
    request.mockResolvedValue(
      Response.json({ code, status: 'success', success: true }, { status: 202 })
    );
    const callbacks = handlers();

    await verifyCheckoutPayment(
      { ...params, reference: 'reference' },
      callbacks
    );

    expect(callbacks.clearCart).not.toHaveBeenCalled();
    expect(callbacks.setStatus).toHaveBeenCalledWith('pending');
    expect(callbacks.scheduleFailedRedirect).not.toHaveBeenCalled();
  });

  it.each([
    'capture_hold_failed',
    'completion_failed',
    'order_fetch_failed',
  ])('keeps a captured-but-unfinalized %s outcome pending instead of failing', async (finalizationOutcome) => {
    // Exact route shape: HTTP 500 tagged with the outcome — the provider
    // took the money, so the page must wait, never record
    // payment_failed or redirect back to checkout (where a retry could
    // duplicate the capture).
    request.mockResolvedValue(
      Response.json(
        { error: 'Failed to finalize order', finalizationOutcome },
        { status: 500 }
      )
    );
    const callbacks = handlers();

    await verifyCheckoutPayment(
      { ...params, reference: 'reference' },
      callbacks
    );

    expect(callbacks.setStatus).toHaveBeenCalledWith('pending');
    expect(callbacks.clearCart).not.toHaveBeenCalled();
    expect(callbacks.capturePaymentFailed).not.toHaveBeenCalled();
    expect(callbacks.scheduleFailedRedirect).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'failed', reason: 'payment_failed' },
    { status: 'cancelled', reason: 'payment_cancelled' },
    { status: 'abandoned', reason: 'payment_abandoned' },
  ])('fails a $status reference verification with the matching failure event', async ({
    status,
    reason,
  }) => {
    // Exact route shape for terminal provider outcomes: the attempt can
    // never settle, so the page shows failure/retry immediately instead
    // of re-polling until the retry budget expires.
    request.mockResolvedValue(
      Response.json({
        success: false,
        status,
        orderId: 'order-id',
        orderNumber: 'ORD-1',
        paymentMethod: 'paystack',
      })
    );
    const callbacks = handlers();

    await verifyCheckoutPayment(
      { ...params, reference: 'reference' },
      callbacks
    );

    expect(callbacks.setStatus).toHaveBeenCalledWith('failed');
    expect(callbacks.clearCart).not.toHaveBeenCalled();
    expect(callbacks.capturePaymentFailed).toHaveBeenCalledWith({
      orderId: 'order-id',
      orderNumber: 'ORD-1',
      paymentMethod: 'paystack',
      reference: 'reference',
      reason,
    });
    expect(callbacks.scheduleFailedRedirect).toHaveBeenCalledTimes(1);
  });

  it('fails a revisited fully-refunded REDVAULT order without clearing the cart', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          payment_method: 'uba_redvault',
          payment_status: 'refunded',
          shipping_status: 'processing',
          order_number: 'ORD-1',
        })
      )
    );
    const callbacks = handlers();

    await verifyCheckoutPayment(params, callbacks);

    expect(callbacks.clearCart).not.toHaveBeenCalled();
    expect(callbacks.setStatus).toHaveBeenCalledWith('failed');
    expect(callbacks.scheduleFailedRedirect).toHaveBeenCalledOnce();
    expect(callbacks.setOrderNumber).toHaveBeenCalledWith('ORD-1');
  });

  it('fails a revisited cancelled REDVAULT order instead of stalling pending', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          payment_method: 'uba_redvault',
          payment_status: 'unpaid',
          shipping_status: 'cancelled',
          order_number: 'ORD-1',
        })
      )
    );
    const callbacks = handlers();

    await verifyCheckoutPayment(params, callbacks);

    expect(callbacks.clearCart).not.toHaveBeenCalled();
    expect(callbacks.setStatus).toHaveBeenCalledWith('failed');
    expect(callbacks.scheduleFailedRedirect).toHaveBeenCalledOnce();
    expect(callbacks.setOrderNumber).toHaveBeenCalledWith('ORD-1');
  });

  it('keeps the cart when a REDVAULT callback reports cancellation', async () => {
    request.mockResolvedValue(
      Response.json({ status: 'cancelled', success: false }, { status: 200 })
    );
    const callbacks = handlers();

    await verifyCheckoutPayment(
      { ...params, reference: 'reference' },
      callbacks
    );

    expect(callbacks.clearCart).not.toHaveBeenCalled();
    expect(callbacks.setStatus).toHaveBeenCalledWith('failed');
    expect(callbacks.scheduleFailedRedirect).toHaveBeenCalledOnce();
  });

  it('retains a matching pending REDVAULT cart when the order lookup fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const callbacks = handlers();

    await verifyCheckoutPayment(
      { ...params, pendingRedvaultOrder: true },
      callbacks
    );

    expect(callbacks.clearCart).not.toHaveBeenCalled();
    expect(callbacks.setPaymentMethod).toHaveBeenCalledWith('uba_redvault');
    expect(callbacks.setStatus).toHaveBeenCalledWith('pending');
  });

  it('holds the ordinary unknown-order network fallback pending', async () => {
    // An offline lookup proves nothing: stay pending with the cart
    // intact instead of confirming an unverified checkout.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const callbacks = handlers();

    await verifyCheckoutPayment(params, callbacks);

    expect(callbacks.clearCart).not.toHaveBeenCalled();
    expect(callbacks.setStatus).toHaveBeenCalledWith('pending');
  });
});

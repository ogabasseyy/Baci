import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyCheckoutPayment } from './verify-checkout-payment';

const request = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: request }));

function handlers() {
  return {
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

  it('keeps the ordinary unknown-order network fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const callbacks = handlers();

    await verifyCheckoutPayment(params, callbacks);

    expect(callbacks.clearCart).toHaveBeenCalledOnce();
    expect(callbacks.setStatus).toHaveBeenCalledWith('success');
  });
});

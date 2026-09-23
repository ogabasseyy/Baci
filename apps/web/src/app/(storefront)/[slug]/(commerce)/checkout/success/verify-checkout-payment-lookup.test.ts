import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyCheckoutPaymentByLookup } from './verify-checkout-payment-lookup';
import type { VerifyCheckoutPaymentLookupHandlers } from './verify-checkout-payment-response';

const mockFetch = vi.fn();

function handlers(): VerifyCheckoutPaymentLookupHandlers {
  return {
    clearCart: vi.fn(),
    scheduleFailedRedirect: vi.fn(),
    setIsVerifying: vi.fn(),
    setOrderNumber: vi.fn(),
    setPaymentMethod: vi.fn(),
    setStatus: vi.fn(),
    capturePaymentCompleted: vi.fn(),
  };
}

function params(overrides = {}) {
  return {
    merchantSlug: 'test-store',
    orderId: 'order-12345678',
    paymentMethod: 'paystack',
    pendingRedvaultOrder: false,
    trackingToken: 'track-1',
    ...overrides,
  };
}

describe('verifyCheckoutPaymentByLookup', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    mockFetch.mockReset();
  });

  it('returns false without an order identity', async () => {
    const h = handlers();

    await expect(
      verifyCheckoutPaymentByLookup(params({ orderId: null }), h)
    ).resolves.toBe(false);
    expect(h.setIsVerifying).not.toHaveBeenCalled();
  });

  it('confirms a paid order and captures the conversion once', async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 'order-12345678',
          order_number: 'BAC-1',
          payment_method: 'paystack',
          payment_status: 'paid',
          total: 21500,
          currency: 'ngn',
        }),
    } as Response);
    const h = handlers();

    await expect(verifyCheckoutPaymentByLookup(params(), h)).resolves.toBe(
      true
    );

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/storefront/orders/order-12345678?merchant_slug=test-store&tracking_token=track-1',
      { signal: undefined }
    );
    expect(h.clearCart).toHaveBeenCalledTimes(1);
    expect(h.setStatus).toHaveBeenCalledWith('success');
    expect(h.setOrderNumber).toHaveBeenCalledWith('BAC-1');
    expect(h.setPaymentMethod).toHaveBeenCalledWith('paystack');
    expect(h.capturePaymentCompleted).toHaveBeenCalledWith({
      orderId: 'order-12345678',
      orderNumber: 'BAC-1',
      paymentMethod: 'paystack',
      total: 21500,
      currency: 'NGN',
    });
    expect(h.setIsVerifying).toHaveBeenCalledWith(false);
  });

  it('routes refunded lookups to reconciling with the cart intact', async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 'order-12345678',
          order_number: 'BAC-2',
          payment_method: 'paystack',
          payment_status: 'refunded',
        }),
    } as Response);
    const h = handlers();

    await expect(verifyCheckoutPaymentByLookup(params(), h)).resolves.toBe(
      true
    );

    expect(h.setStatus).toHaveBeenCalledWith('reconciling');
    expect(h.setOrderNumber).toHaveBeenCalledWith('BAC-2');
    expect(h.clearCart).not.toHaveBeenCalled();
    expect(h.capturePaymentCompleted).not.toHaveBeenCalled();
  });

  it.each([
    'Cancelled',
    'canceled',
  ])('fails ordinary %s lookups as unpaid instead of promising a refund', async (paymentStatus) => {
    // A cancelled row proves no capture (maintenance flips stale unpaid
    // orders): terminal unpaid failure with the cart intact — never the
    // "Payment Received" reconciliation view. Both spellings normalize
    // before either branch.
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 'order-12345678',
          order_number: 'BAC-2',
          payment_method: 'paystack',
          payment_status: paymentStatus,
        }),
    } as Response);
    const h = handlers();

    await expect(verifyCheckoutPaymentByLookup(params(), h)).resolves.toBe(
      true
    );

    expect(h.setStatus).toHaveBeenCalledWith('failed');
    expect(h.setOrderNumber).toHaveBeenCalledWith('BAC-2');
    expect(h.setPaymentMethod).toHaveBeenCalledWith('paystack');
    expect(h.scheduleFailedRedirect).toHaveBeenCalledTimes(1);
    expect(h.clearCart).not.toHaveBeenCalled();
    expect(h.capturePaymentCompleted).not.toHaveBeenCalled();
  });

  it('holds unpaid REDVAULT orders in pending without clearing the cart', async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 'order-12345678',
          order_number: 'BAC-3',
          payment_method: 'uba_redvault',
          payment_status: 'pending',
        }),
    } as Response);
    const h = handlers();

    await expect(verifyCheckoutPaymentByLookup(params(), h)).resolves.toBe(
      true
    );

    expect(h.setPaymentMethod).toHaveBeenCalledWith('uba_redvault');
    expect(h.setStatus).toHaveBeenCalledWith('pending');
    expect(h.clearCart).not.toHaveBeenCalled();
  });

  it('fails terminal-cancelled REDVAULT orders and schedules the redirect', async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 'order-12345678',
          order_number: 'BAC-4',
          payment_method: 'uba_redvault',
          payment_status: 'unpaid',
          shipping_status: 'cancelled',
        }),
    } as Response);
    const h = handlers();

    await verifyCheckoutPaymentByLookup(params(), h);

    expect(h.setStatus).toHaveBeenCalledWith('failed');
    expect(h.scheduleFailedRedirect).toHaveBeenCalledTimes(1);
    expect(h.clearCart).not.toHaveBeenCalled();
  });

  it('fails legacy-spelled cancelled REDVAULT orders too', async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 'order-12345678',
          order_number: 'BAC-4b',
          payment_method: 'uba_redvault',
          payment_status: 'unpaid',
          shipping_status: 'canceled',
        }),
    } as Response);
    const h = handlers();

    await verifyCheckoutPaymentByLookup(params(), h);

    expect(h.setStatus).toHaveBeenCalledWith('failed');
    expect(h.scheduleFailedRedirect).toHaveBeenCalledTimes(1);
    expect(h.clearCart).not.toHaveBeenCalled();
  });

  it.each([
    'canceled',
    'cancelled',
  ])('fails REDVAULT orders with a %s payment status whatever the shipping state', async (paymentStatus) => {
    // A canceled payment is terminal even when shipping never flipped:
    // pending here would wait on money that can never settle.
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 'order-12345678',
          order_number: 'BAC-4c',
          payment_method: 'uba_redvault',
          payment_status: paymentStatus,
          shipping_status: 'processing',
        }),
    } as Response);
    const h = handlers();

    await verifyCheckoutPaymentByLookup(params(), h);

    expect(h.setStatus).toHaveBeenCalledWith('failed');
    expect(h.scheduleFailedRedirect).toHaveBeenCalledTimes(1);
    expect(h.clearCart).not.toHaveBeenCalled();
  });

  it('fails terminal-refunded REDVAULT orders without presenting success', async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 'order-12345678',
          order_number: 'BAC-5',
          payment_method: 'uba_redvault',
          payment_status: 'refunded',
        }),
    } as Response);
    const h = handlers();

    await verifyCheckoutPaymentByLookup(params(), h);

    expect(h.setStatus).toHaveBeenCalledWith('failed');
    expect(h.scheduleFailedRedirect).toHaveBeenCalledTimes(1);
    expect(h.clearCart).not.toHaveBeenCalled();
  });

  it('retains the REDVAULT cart when the lookup fails', async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue(new Response(null, { status: 500 }));
    const h = handlers();

    await expect(
      verifyCheckoutPaymentByLookup(params({ pendingRedvaultOrder: true }), h)
    ).resolves.toBe(true);

    expect(h.setPaymentMethod).toHaveBeenCalledWith('uba_redvault');
    expect(h.setStatus).toHaveBeenCalledWith('pending');
    expect(h.setOrderNumber).toHaveBeenCalledWith('ORDER-12');
    expect(h.clearCart).not.toHaveBeenCalled();
  });

  it('stays pending with the cart intact when a non-REDVAULT lookup fails', async () => {
    // An unproven lookup (stale token/order pair or transient failure)
    // must never confirm success or discard the cart.
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue(new Response(null, { status: 500 }));
    const h = handlers();

    await verifyCheckoutPaymentByLookup(params(), h);

    expect(h.clearCart).not.toHaveBeenCalled();
    expect(h.setStatus).toHaveBeenCalledWith('pending');
    expect(h.setOrderNumber).toHaveBeenCalledWith('ORDER-12');
    expect(h.capturePaymentCompleted).not.toHaveBeenCalled();
  });

  it('logs lookup failures but stays silent on aborts', async () => {
    vi.stubGlobal('fetch', mockFetch);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockFetch.mockRejectedValueOnce(new Error('network down'));
    const failedHandlers = handlers();
    await verifyCheckoutPaymentByLookup(params(), failedHandlers);
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to fetch order details on success page:',
      expect.any(Error)
    );
    // Non-abort errors are equally unproven: pending with the cart
    // intact, never a success confirmation.
    expect(failedHandlers.setStatus).toHaveBeenCalledWith('pending');
    expect(failedHandlers.clearCart).not.toHaveBeenCalled();
    expect(failedHandlers.capturePaymentCompleted).not.toHaveBeenCalled();

    errorSpy.mockClear();
    mockFetch.mockRejectedValueOnce(new DOMException('x', 'AbortError'));
    const h = handlers();
    await verifyCheckoutPaymentByLookup(params(), h);
    expect(errorSpy).not.toHaveBeenCalled();
    // An aborted bound leaves the order unverified: pending (the
    // polling hook retries) with the cart intact, never success.
    expect(h.setStatus).toHaveBeenCalledWith('pending');
    expect(h.setOrderNumber).toHaveBeenCalledWith('ORDER-12');
    expect(h.clearCart).not.toHaveBeenCalled();
    expect(h.capturePaymentCompleted).not.toHaveBeenCalled();
  });

  it('stays pending when an abort hits a REDVAULT-context lookup', async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockRejectedValueOnce(new DOMException('x', 'AbortError'));
    const h = handlers();

    await expect(
      verifyCheckoutPaymentByLookup(params({ pendingRedvaultOrder: true }), h)
    ).resolves.toBe(true);

    expect(h.setPaymentMethod).toHaveBeenCalledWith('uba_redvault');
    expect(h.setStatus).toHaveBeenCalledWith('pending');
    expect(h.clearCart).not.toHaveBeenCalled();
  });

  it('holds a REDVAULT-context lookup pending when the RPC omits payment_method', async () => {
    // Actual get_order_tracking shape: payment_status without
    // payment_method. The proof-bound REDVAULT context must still route
    // this to pending instead of the generic success branch.
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 'order-12345678',
          order_number: 'BAC-6',
          payment_status: 'pending',
          shipping_status: 'pending',
          total: 5750,
          currency: 'NGN',
        }),
    } as Response);
    const h = handlers();

    await expect(
      verifyCheckoutPaymentByLookup(params({ pendingRedvaultOrder: true }), h)
    ).resolves.toBe(true);

    expect(h.setPaymentMethod).toHaveBeenCalledWith('uba_redvault');
    expect(h.setStatus).toHaveBeenCalledWith('pending');
    expect(h.clearCart).not.toHaveBeenCalled();
    expect(h.capturePaymentCompleted).not.toHaveBeenCalled();
  });

  it('fails a REDVAULT-context lookup when the method-less RPC shows a cancelled order', async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 'order-12345678',
          order_number: 'BAC-7',
          payment_status: 'unpaid',
          shipping_status: 'cancelled',
          total: 5750,
          currency: 'NGN',
        }),
    } as Response);
    const h = handlers();

    await expect(
      verifyCheckoutPaymentByLookup(params({ pendingRedvaultOrder: true }), h)
    ).resolves.toBe(true);

    expect(h.setStatus).toHaveBeenCalledWith('failed');
    expect(h.scheduleFailedRedirect).toHaveBeenCalledTimes(1);
    expect(h.clearCart).not.toHaveBeenCalled();
  });

  it('rejects a tracking-token lookup that returns a different order', async () => {
    // The token RPC resolves by token (p_order_id: null): a stale or
    // mismatched URL must never clear the cart or record
    // payment_completed under the URL order ID with another order's
    // number, total, and currency.
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 'order-other',
          order_number: 'BAC-9',
          payment_method: 'paystack',
          payment_status: 'paid',
          total: 99900,
          currency: 'KES',
        }),
    } as Response);
    const h = handlers();

    await expect(verifyCheckoutPaymentByLookup(params(), h)).resolves.toBe(
      true
    );

    expect(h.capturePaymentCompleted).not.toHaveBeenCalled();
    // Failed-lookup fallback: derived number, never the stranger's.
    expect(h.setOrderNumber).toHaveBeenCalledWith('ORDER-12');
    expect(h.setOrderNumber).not.toHaveBeenCalledWith('BAC-9');
  });

  it('prefers an explicit RPC payment_method over the REDVAULT context', async () => {
    // A stale session snapshot must not reclassify an order the RPC
    // positively identifies as another method.
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 'order-12345678',
          order_number: 'BAC-8',
          payment_method: 'paystack',
          payment_status: 'paid',
          total: 21500,
          currency: 'ngn',
        }),
    } as Response);
    const h = handlers();

    await expect(
      verifyCheckoutPaymentByLookup(params({ pendingRedvaultOrder: true }), h)
    ).resolves.toBe(true);

    expect(h.setStatus).toHaveBeenCalledWith('success');
    expect(h.setPaymentMethod).toHaveBeenCalledWith('paystack');
    expect(h.clearCart).toHaveBeenCalledTimes(1);
  });
});

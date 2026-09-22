import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isAbortError,
  isVerificationResponse,
  normalizeCurrencyCode,
  type VerifyCheckoutPaymentLookupHandlers,
  verifyCheckoutPaymentByLookup,
} from './verify-checkout-payment-lookup';

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

describe('verifyCheckoutPaymentByLookup helpers', () => {
  it('normalizes currency codes', () => {
    expect(normalizeCurrencyCode(' ngn ')).toBe('NGN');
    expect(normalizeCurrencyCode('')).toBeUndefined();
    expect(normalizeCurrencyCode(42)).toBeUndefined();
  });

  it('validates verification response shapes', () => {
    expect(isVerificationResponse({ status: 'success' })).toBe(true);
    expect(isVerificationResponse({ status: 'abandoned' })).toBe(true);
    expect(isVerificationResponse({ status: 'bogus' })).toBe(false);
    expect(isVerificationResponse(null)).toBe(false);
    expect(isVerificationResponse([])).toBe(false);
    expect(isVerificationResponse({ orderNumber: 42 })).toBe(false);
  });

  it('detects abort errors only', () => {
    expect(isAbortError(new DOMException('x', 'AbortError'))).toBe(true);
    expect(isAbortError(new Error('x'))).toBe(false);
  });
});

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

  it('fails ordinary cancelled lookups as unpaid instead of promising a refund', async () => {
    // A cancelled row proves no capture (maintenance flips stale unpaid
    // orders): terminal unpaid failure with the cart intact — never the
    // "Payment Received" reconciliation view.
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          order_number: 'BAC-2',
          payment_method: 'paystack',
          payment_status: 'Cancelled',
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

  it('fails terminal-refunded REDVAULT orders without presenting success', async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
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

  it('falls back to derived success when a non-REDVAULT lookup fails', async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue(new Response(null, { status: 500 }));
    const h = handlers();

    await verifyCheckoutPaymentByLookup(params(), h);

    expect(h.clearCart).toHaveBeenCalledTimes(1);
    expect(h.setStatus).toHaveBeenCalledWith('success');
    expect(h.setOrderNumber).toHaveBeenCalledWith('ORDER-12');
  });

  it('logs lookup failures but stays silent on aborts', async () => {
    vi.stubGlobal('fetch', mockFetch);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockFetch.mockRejectedValueOnce(new Error('network down'));
    await verifyCheckoutPaymentByLookup(params(), handlers());
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to fetch order details on success page:',
      expect.any(Error)
    );

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

  it('prefers an explicit RPC payment_method over the REDVAULT context', async () => {
    // A stale session snapshot must not reclassify an order the RPC
    // positively identifies as another method.
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
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

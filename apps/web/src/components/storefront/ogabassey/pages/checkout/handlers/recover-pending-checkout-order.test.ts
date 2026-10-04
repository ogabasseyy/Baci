import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCheckoutIdempotencyKey } from '../checkout-idempotency';
import {
  type RecoverPendingCheckoutOrderOptions,
  recoverPendingCheckoutOrder,
} from './recover-pending-checkout-order';

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, init),
}));
vi.mock('../checkout-idempotency', () => ({
  clearCheckoutIdempotencyKey: vi.fn(),
}));

const mockFetch = vi.fn<typeof fetch>();
function options(): RecoverPendingCheckoutOrderOptions {
  return {
    reuse: {
      pendingOrder: {
        orderId: 'order-1',
        trackingToken: 'token-1',
        merchantId: 'merchant-1',
        customerEmail: 'ada@example.com',
        customerPhone: '+2348012345678',
        checkoutFingerprint: 'fingerprint-1',
        paymentMethod: 'card',
        amountDueToGateway: 1000,
        createdAt: '2026-09-26T00:00:00Z',
      },
      merchantId: 'merchant-1',
      merchantSlug: 'test-store',
      customerEmail: 'ada@example.com',
      checkoutFingerprint: 'fingerprint-1',
      paymentMethod: 'bank_transfer',
      shippingProvider: null,
    },
    context: {
      firstName: 'Ada',
      lastName: 'Eze',
      customerPhone: '+2348012345678',
      finalAddress: '1 Test St',
      finalCity: 'Lagos',
      finalState: 'Lagos',
      merchantCountry: 'NG',
      waitForResolvedStorefrontCustomerAuth: vi.fn(async () => true),
      isOrderInFlightRef: { current: true },
      setIsProcessing: vi.fn(),
      setRedvaultStatus: vi.fn(),
      clearPendingCheckoutOrder: vi.fn(),
      clearCheckoutSession: vi.fn(),
      clearCart: vi.fn(),
      pushSuccessRoute: vi.fn(),
    },
  };
}
const pendingResponse = () =>
  Response.json({
    id: 'order-1',
    payment_status: 'pending',
    shipping_status: 'pending',
    total: 1000,
  });

describe('recoverPendingCheckoutOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('allows a fresh checkout without network or cleanup side effects', async () => {
    const input = options();
    input.reuse.pendingOrder = null;
    await expect(recoverPendingCheckoutOrder(input)).resolves.toEqual({
      kind: 'submit',
      pendingOrder: { reusableOrder: null, clearStoredOrder: false },
    });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(input.context.clearPendingCheckoutOrder).not.toHaveBeenCalled();
  });

  it.each([
    'card',
    'bank_transfer',
    'credit_direct',
    'credpal',
    'invoice',
    'pod',
  ])('reuses the same order when switching from card to %s', async (paymentMethod) => {
    const input = options();
    input.reuse.paymentMethod = paymentMethod;
    mockFetch
      .mockResolvedValueOnce(pendingResponse())
      .mockResolvedValueOnce(
        Response.json({ order: { id: 'order-1', tracking_token: 'token-1' } })
      );
    await expect(recoverPendingCheckoutOrder(input)).resolves.toEqual({
      kind: 'submit',
      pendingOrder: {
        reusableOrder: {
          order: { id: 'order-1', tracking_token: 'token-1' },
          amountDueToGateway: 1000,
        },
        clearStoredOrder: false,
      },
    });
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      '/api/orders/reuse',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining(`"payment_method":"${paymentMethod}"`),
      })
    );
    expect(input.context.clearPendingCheckoutOrder).not.toHaveBeenCalled();
  });

  it.each([
    'lookup',
    'reuse',
  ])('preserves the snapshot on a %s failure', async (stage) => {
    const input = options();
    if (stage === 'reuse') mockFetch.mockResolvedValueOnce(pendingResponse());
    mockFetch.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    await expect(recoverPendingCheckoutOrder(input)).rejects.toThrow(
      /Failed to/
    );
    expect(input.context.clearPendingCheckoutOrder).not.toHaveBeenCalled();
    expect(input.context.clearCart).not.toHaveBeenCalled();
    expect(input.context.pushSuccessRoute).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(stage === 'lookup' ? 1 : 2);
  });

  it('clears a mismatched snapshot before permitting submission', async () => {
    const input = options();
    input.reuse.checkoutFingerprint = 'changed';
    await expect(recoverPendingCheckoutOrder(input)).resolves.toEqual({
      kind: 'submit',
      pendingOrder: { reusableOrder: null, clearStoredOrder: false },
    });
    expect(input.context.clearPendingCheckoutOrder).toHaveBeenCalledOnce();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('finishes a paid order without exposing another submission', async () => {
    const input = options();
    mockFetch.mockResolvedValueOnce(
      Response.json({ id: 'order-1', payment_status: 'paid' })
    );
    await expect(recoverPendingCheckoutOrder(input)).resolves.toEqual({
      kind: 'handled',
    });
    expect(input.context.clearPendingCheckoutOrder).toHaveBeenCalledOnce();
    expect(clearCheckoutIdempotencyKey).toHaveBeenCalledWith('fingerprint-1');
    expect(input.context.clearCheckoutSession).toHaveBeenCalledOnce();
    expect(input.context.clearCart).toHaveBeenCalledOnce();
    expect(input.context.pushSuccessRoute).toHaveBeenCalledWith(
      '/order-success?orderId=order-1&email=ada%40example.com&trackingToken=token-1'
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('blocks leaving a still-pending REDVAULT order', async () => {
    const input = options();
    if (!input.reuse.pendingOrder) throw new Error('Missing test snapshot');
    input.reuse.pendingOrder.paymentMethod = 'uba_redvault';
    mockFetch.mockResolvedValueOnce(pendingResponse());
    await expect(recoverPendingCheckoutOrder(input)).rejects.toThrow(
      'still being verified'
    );
    expect(input.context.clearPendingCheckoutOrder).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    409, 500,
  ])('blocks entering REDVAULT when cancellation returns %s', async (status) => {
    const input = options();
    input.reuse.paymentMethod = 'uba_redvault';
    mockFetch
      .mockResolvedValueOnce(pendingResponse())
      .mockResolvedValueOnce(new Response('{}', { status }));
    await expect(recoverPendingCheckoutOrder(input)).rejects.toThrow();
    expect(input.context.clearPendingCheckoutOrder).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('awaits safe cancellation before clearing and permitting REDVAULT entry', async () => {
    const input = options();
    input.reuse.paymentMethod = 'uba_redvault';
    mockFetch
      .mockResolvedValueOnce(pendingResponse())
      .mockImplementationOnce(async () => {
        expect(input.context.clearPendingCheckoutOrder).not.toHaveBeenCalled();
        return Response.json({});
      });
    await expect(recoverPendingCheckoutOrder(input)).resolves.toEqual({
      kind: 'submit',
      pendingOrder: { reusableOrder: null, clearStoredOrder: false },
    });
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      '/api/storefront/account/orders/order-1/cancel',
      expect.objectContaining({ method: 'POST' })
    );
    expect(input.context.clearPendingCheckoutOrder).toHaveBeenCalledOnce();
  });
  it.each([
    'REDVAULT_RECONCILIATION_REQUIRED',
    'REDVAULT_CAPTURE_HELD',
  ])('handles a live REDVAULT replay with %s without permitting submission', async (code) => {
    const input = options();
    input.reuse.paymentMethod = 'uba_redvault';
    if (!input.reuse.pendingOrder) throw new Error('Missing test snapshot');
    input.reuse.pendingOrder.paymentMethod = 'uba_redvault';
    mockFetch
      .mockResolvedValueOnce(pendingResponse())
      .mockResolvedValueOnce(new Response('{}', { status: 409 }))
      .mockResolvedValueOnce(Response.json({ code }, { status: 202 }));
    await expect(recoverPendingCheckoutOrder(input)).resolves.toEqual({
      kind: 'handled',
    });
    expect(input.context.clearPendingCheckoutOrder).not.toHaveBeenCalled();
    expect(input.context.clearCart).not.toHaveBeenCalled();
    expect(input.context.setIsProcessing).toHaveBeenCalledWith(false);
    expect(input.context.isOrderInFlightRef.current).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});

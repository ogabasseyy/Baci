import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCheckoutIdempotencyKey } from '../checkout-idempotency';
import type { ResolvePendingCheckoutOrderResult } from '../pending-checkout-order';
import {
  resolveRedvaultSubmitFence,
  type ResolveRedvaultSubmitFenceOptions,
} from './redvault-submit-fence';

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, init),
}));

vi.mock('../checkout-idempotency', () => ({
  clearCheckoutIdempotencyKey: vi.fn(),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

const assignLocation = vi.fn();
Object.defineProperty(window, 'location', {
  value: { assign: assignLocation },
  writable: true,
});

function buildOptions(
  fence: ResolvePendingCheckoutOrderResult,
  overrides: Partial<ResolveRedvaultSubmitFenceOptions> = {}
): ResolveRedvaultSubmitFenceOptions {
  return {
    fence,
    checkoutFingerprint: 'fingerprint-1',
    customerEmail: 'ada@example.com',
    merchantId: 'merchant-1',
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
    ...overrides,
  };
}

describe('resolveRedvaultSubmitFence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it('throws while a REDVAULT payment is still being verified', async () => {
    const options = buildOptions({
      reusableOrder: null,
      clearStoredOrder: false,
      redvaultUnresolved: true,
    });

    await expect(resolveRedvaultSubmitFence(options)).rejects.toThrow(
      'Your UBA payment is still being verified.'
    );
    expect(options.pushSuccessRoute).not.toHaveBeenCalled();
  });

  it('routes a paid fenced order to the completed order', async () => {
    const pushSuccessRoute = vi.fn();
    const options = buildOptions(
      {
        reusableOrder: null,
        clearStoredOrder: true,
        paidOrder: {
          orderId: 'order-1',
          orderNumber: 'RV-1',
          trackingToken: 'track-1',
          customerEmail: 'ada@example.com',
        },
      },
      { pushSuccessRoute }
    );

    await expect(resolveRedvaultSubmitFence(options)).resolves.toBe(true);
    expect(options.clearPendingCheckoutOrder).toHaveBeenCalled();
    expect(clearCheckoutIdempotencyKey).toHaveBeenCalledWith('fingerprint-1');
    expect(options.clearCheckoutSession).toHaveBeenCalled();
    expect(options.clearCart).toHaveBeenCalled();
    expect(pushSuccessRoute).toHaveBeenCalledWith(
      expect.stringContaining('/order-success?')
    );
    expect(String(pushSuccessRoute.mock.calls[0]?.[0])).toContain(
      'trackingToken=track-1'
    );
  });

  it('cancels a blocking ordinary order and continues', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const options = buildOptions({
      reusableOrder: null,
      clearStoredOrder: false,
      ordinaryPendingOrder: {
        orderId: 'order-2',
        orderNumber: 'ORD-2',
        trackingToken: 'track-2',
        customerEmail: 'ada@example.com',
      },
    });

    await expect(resolveRedvaultSubmitFence(options)).resolves.toBe(false);
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain(
      '/api/storefront/account/orders/order-2/cancel'
    );
    expect(options.clearPendingCheckoutOrder).toHaveBeenCalled();
  });

  it('throws when the blocking ordinary order is already initializing', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{}', { status: 409 }));
    const options = buildOptions({
      reusableOrder: null,
      clearStoredOrder: false,
      ordinaryPendingOrder: {
        orderId: 'order-2',
        customerEmail: 'ada@example.com',
      },
    });

    await expect(resolveRedvaultSubmitFence(options)).rejects.toThrow(
      'Your previous order is still being processed.'
    );
    expect(options.clearPendingCheckoutOrder).not.toHaveBeenCalled();
  });

  it('throws when the blocking ordinary order cannot be released', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    const options = buildOptions({
      reusableOrder: null,
      clearStoredOrder: false,
      ordinaryPendingOrder: {
        orderId: 'order-2',
        customerEmail: 'ada@example.com',
      },
    });

    await expect(resolveRedvaultSubmitFence(options)).rejects.toThrow(
      'We could not release your previous order. Please try again.'
    );
  });

  it('cancels a stale same-lane order and continues', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const options = buildOptions({
      reusableOrder: null,
      clearStoredOrder: false,
      redvaultPendingOrder: {
        orderId: 'order-1',
        orderNumber: 'RV-1',
        trackingToken: 'track-1',
        customerEmail: 'ada@example.com',
      },
    });

    await expect(resolveRedvaultSubmitFence(options)).resolves.toBe(false);
    expect(options.clearPendingCheckoutOrder).toHaveBeenCalled();
  });

  it('replays a live same-lane order instead of duplicating it', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('{}', { status: 409 }))
      .mockResolvedValueOnce(
        Response.json({ authorization_url: 'https://paystack.test/pay/live' })
      );
    const options = buildOptions({
      reusableOrder: null,
      clearStoredOrder: false,
      redvaultPendingOrder: {
        orderId: 'order-1',
        orderNumber: 'RV-1',
        trackingToken: 'track-1',
        customerEmail: 'ada@example.com',
      },
    });

    await expect(resolveRedvaultSubmitFence(options)).resolves.toBe(true);
    expect(assignLocation).toHaveBeenCalledWith(
      'https://paystack.test/pay/live'
    );
    expect(options.clearPendingCheckoutOrder).not.toHaveBeenCalled();
  });

  it('throws when the live replay cannot be reopened', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('{}', { status: 409 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'boom' }), { status: 500 })
      );
    const options = buildOptions({
      reusableOrder: null,
      clearStoredOrder: false,
      redvaultPendingOrder: {
        orderId: 'order-1',
        customerEmail: 'ada@example.com',
      },
    });

    await expect(resolveRedvaultSubmitFence(options)).rejects.toThrow(
      'We could not reopen your previous UBA payment. Please try again.'
    );
    expect(options.setRedvaultStatus).toHaveBeenCalledWith('error');
  });

  it('throws when the stale same-lane order cannot be released', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    const options = buildOptions({
      reusableOrder: null,
      clearStoredOrder: false,
      redvaultPendingOrder: {
        orderId: 'order-1',
        customerEmail: 'ada@example.com',
      },
    });

    await expect(resolveRedvaultSubmitFence(options)).rejects.toThrow(
      'We could not release your previous UBA payment. Please try again.'
    );
  });

  it('clears the stored order and continues', async () => {
    const options = buildOptions({
      reusableOrder: null,
      clearStoredOrder: true,
    });

    await expect(resolveRedvaultSubmitFence(options)).resolves.toBe(false);
    expect(options.clearPendingCheckoutOrder).toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('continues when the fence carries no verdict', async () => {
    const options = buildOptions({
      reusableOrder: null,
      clearStoredOrder: false,
    });

    await expect(resolveRedvaultSubmitFence(options)).resolves.toBe(false);
    expect(options.clearPendingCheckoutOrder).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

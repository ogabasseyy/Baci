import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '@/hooks/use-toast';
import { createClient } from '@/lib/supabase/client';
import {
  submitRedvaultPreparedOrder,
  type RedvaultPreparedOrder,
  type SubmitRedvaultPreparedOrderOptions,
} from './redvault-prepared-order-submit';

vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, init),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

const assignLocation = vi.fn();
Object.defineProperty(window, 'location', {
  value: { assign: assignLocation },
  writable: true,
});

function preparedOrder(
  overrides: Partial<RedvaultPreparedOrder> = {}
): RedvaultPreparedOrder {
  return {
    billingAddress: {
      line1: '1 Test St',
      city: 'Lagos',
      state: 'Lagos',
      country: 'NG',
    },
    customerEmail: 'ada@example.com',
    customerName: 'Ada Eze',
    customerPhone: '+2348012345678',
    currency: 'NGN',
    orderId: 'order-1',
    checkoutFingerprint: 'fingerprint-1',
    trackingToken: 'track-1',
    ...overrides,
  };
}

function buildOptions(
  overrides: Partial<SubmitRedvaultPreparedOrderOptions> = {}
): SubmitRedvaultPreparedOrderOptions {
  return {
    paymentMethod: 'uba_redvault',
    redvaultOrderReady: preparedOrder(),
    checkoutFingerprint: 'fingerprint-1',
    waitForResolvedStorefrontCustomerAuth: vi.fn(async () => true),
    isOrderInFlightRef: { current: true },
    setIsProcessing: vi.fn(),
    setRedvaultStatus: vi.fn(),
    setRedvaultOrderReady: vi.fn(),
    clearPendingCheckoutOrder: vi.fn(),
    createAccount: false,
    user: null,
    accountPassword: '',
    firstName: 'Ada',
    lastName: 'Eze',
    merchantId: 'merchant-1',
    ...overrides,
  };
}

describe('submitRedvaultPreparedOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    vi.mocked(createClient).mockReturnValue({
      auth: {
        signUp: vi.fn().mockResolvedValue({ data: null, error: null }),
        getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      },
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    } as never);
  });

  it('continues when the payment method is not REDVAULT', async () => {
    const options = buildOptions({
      paymentMethod: 'paystack',
      redvaultOrderReady: preparedOrder(),
    });

    await expect(submitRedvaultPreparedOrder(options)).resolves.toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(options.setIsProcessing).not.toHaveBeenCalled();
  });

  it('continues when no REDVAULT order is prepared', async () => {
    const options = buildOptions({ redvaultOrderReady: null });

    await expect(submitRedvaultPreparedOrder(options)).resolves.toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('initializes a prepared order and redirects to the hosted URL', async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({ authorization_url: 'https://paystack.test/pay/1' })
    );
    const options = buildOptions();

    await expect(submitRedvaultPreparedOrder(options)).resolves.toBe(true);
    expect(assignLocation).toHaveBeenCalledWith('https://paystack.test/pay/1');
    expect(options.setRedvaultOrderReady).toHaveBeenCalledWith(null);
    expect(options.setRedvaultStatus).toHaveBeenCalledWith('pending');
  });

  it('reports the payment start with the init reference before redirecting', async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        authorization_url: 'https://paystack.test/pay/1',
        reference: 'rv-ref-1',
      })
    );
    const onPaymentStarted = vi.fn();
    const options = buildOptions({ onPaymentStarted });

    await expect(submitRedvaultPreparedOrder(options)).resolves.toBe(true);
    expect(onPaymentStarted).toHaveBeenCalledTimes(1);
    expect(onPaymentStarted).toHaveBeenCalledWith({
      orderId: 'order-1',
      currency: 'NGN',
      reference: 'rv-ref-1',
    });
  });

  it('reports no start when initialization never opens a provider flow', async () => {
    const onPaymentStarted = vi.fn();
    mockFetch.mockResolvedValueOnce(
      Response.json({ code: 'REDVAULT_CAPTURE_HELD' }, { status: 202 })
    );

    await expect(
      submitRedvaultPreparedOrder(buildOptions({ onPaymentStarted }))
    ).resolves.toBe(true);
    expect(onPaymentStarted).not.toHaveBeenCalled();
  });

  it('cancels a stale prepared order and continues with a fresh one', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const options = buildOptions({
      redvaultOrderReady: preparedOrder({
        checkoutFingerprint: 'fingerprint-old',
      }),
    });

    await expect(submitRedvaultPreparedOrder(options)).resolves.toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain(
      '/api/storefront/account/orders/order-1/cancel'
    );
    expect(options.setRedvaultOrderReady).toHaveBeenCalledWith(null);
    expect(options.clearPendingCheckoutOrder).toHaveBeenCalled();
  });

  it('stops when the stale cancel is unproven', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    const options = buildOptions({
      redvaultOrderReady: preparedOrder({
        checkoutFingerprint: 'fingerprint-old',
      }),
    });

    await expect(submitRedvaultPreparedOrder(options)).resolves.toBe(true);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Order Still Processing' })
    );
    expect(options.clearPendingCheckoutOrder).not.toHaveBeenCalled();
    expect(options.isOrderInFlightRef.current).toBe(false);
    expect(options.setIsProcessing).toHaveBeenCalledWith(false);
  });

  it('replays a live prepared order instead of duplicating it', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('{}', { status: 409 }))
      .mockResolvedValueOnce(
        Response.json({ authorization_url: 'https://paystack.test/pay/live' })
      );
    const options = buildOptions({
      redvaultOrderReady: preparedOrder({
        checkoutFingerprint: 'fingerprint-old',
      }),
    });

    await expect(submitRedvaultPreparedOrder(options)).resolves.toBe(true);
    expect(assignLocation).toHaveBeenCalledWith(
      'https://paystack.test/pay/live'
    );
    expect(options.clearPendingCheckoutOrder).not.toHaveBeenCalled();
  });

  it('stops in the held state without redirecting', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: 'REDVAULT_CAPTURE_HELD' }),
        { status: 202 }
      )
    );
    const options = buildOptions();

    await expect(submitRedvaultPreparedOrder(options)).resolves.toBe(true);
    expect(assignLocation).not.toHaveBeenCalled();
    expect(options.setRedvaultStatus).toHaveBeenCalledWith('held');
    expect(options.setIsProcessing).toHaveBeenCalledWith(false);
  });

  it('stops while reconciliation is pending', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: 'REDVAULT_RECONCILIATION_REQUIRED' }),
        { status: 202 }
      )
    );
    const options = buildOptions();

    await expect(submitRedvaultPreparedOrder(options)).resolves.toBe(true);
    expect(assignLocation).not.toHaveBeenCalled();
    expect(options.setIsProcessing).toHaveBeenCalledWith(false);
  });

  it('stops with an error when initialization fails', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'boom' }), { status: 500 })
    );
    const options = buildOptions();

    await expect(submitRedvaultPreparedOrder(options)).resolves.toBe(true);
    expect(assignLocation).not.toHaveBeenCalled();
    expect(options.setRedvaultStatus).toHaveBeenCalledWith('error');
  });

  it('blocks payment when the guest attach rejects the new session', async () => {
    vi.mocked(createClient).mockReturnValue({
      auth: {
        signUp: vi.fn().mockResolvedValue({ data: null, error: null }),
        getSession: vi
          .fn()
          .mockResolvedValue({ data: { session: { user: { id: 'u1' } } } }),
      },
      rpc: vi.fn().mockResolvedValue({ data: false, error: null }),
    } as never);
    const options = buildOptions({
      createAccount: true,
      accountPassword: 'secret1',
    });

    await expect(submitRedvaultPreparedOrder(options)).resolves.toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(options.setRedvaultStatus).toHaveBeenCalledWith('error');
  });

  it('tolerates signup failure and initializes under the guest identity', async () => {
    vi.mocked(createClient).mockReturnValue({
      auth: {
        signUp: vi.fn().mockRejectedValue(new Error('exists')),
        getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      },
      rpc: vi.fn(),
    } as never);
    mockFetch.mockResolvedValueOnce(
      Response.json({ authorization_url: 'https://paystack.test/pay/guest' })
    );
    const options = buildOptions({
      createAccount: true,
      accountPassword: 'secret1',
    });

    await expect(submitRedvaultPreparedOrder(options)).resolves.toBe(true);
    expect(assignLocation).toHaveBeenCalledWith(
      'https://paystack.test/pay/guest'
    );
  });
});

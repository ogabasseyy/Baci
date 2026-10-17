import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getSession: vi.fn(),
  invalidateQueries: vi.fn(),
}));

vi.stubGlobal('fetch', mocks.fetch);
vi.mock('@/lib/api-client', () => ({ BASE_URL: 'https://example.test' }));
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: mocks.getSession } },
}));
vi.mock('../useMerchant', () => ({
  useMerchant: () => ({ merchant: { id: 'merchant-1' } }),
}));
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return {
    ...actual,
    useMutation: vi.fn((options) => options),
    useQueryClient: () => ({
      cancelQueries: vi.fn(),
      getQueriesData: vi.fn(() => []),
      invalidateQueries: mocks.invalidateQueries,
      setQueriesData: vi.fn(),
    }),
  };
});

import { useUpdateOrderStatus } from './useOrderStatusUpdate';

const unconfirmedOutcome = {
  name: 'OrderStatusUpdateError',
  code: 'SHIPMENT_BOOKING_UNCONFIRMED',
  message:
    'We could not confirm the shipping result. Check this order’s shipment status before booking again. If it remains unclear, contact support to avoid a duplicate shipment.',
};

function useOrderStatusMutation() {
  const client = new QueryClient({
    defaultOptions: {
      mutations: { retry: 3, retryDelay: 0, gcTime: Number.POSITIVE_INFINITY },
    },
  });
  return new MutationObserver(
    client,
    useUpdateOrderStatus() as unknown as ConstructorParameters<
      typeof MutationObserver
    >[1]
  );
}

describe('order shipping transport failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: 'test-token' } },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows the automatic price check and booking to finish after the old 15-second deadline', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    mocks.fetch.mockImplementation((_url, options: RequestInit) => {
      signal = options.signal ?? undefined;
      return new Promise((resolve) => {
        setTimeout(
          () =>
            resolve(
              new Response(
                JSON.stringify({
                  order: { id: 'order-1', shipping_status: 'shipped' },
                }),
                { status: 200 }
              )
            ),
          20000
        );
      });
    });
    const result = useOrderStatusMutation()
      .mutate({ orderId: 'order-1', status: 'shipped' })
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(20000);
    expect(await result).toMatchObject({
      id: 'order-1',
      shipping_status: 'shipped',
    });
    expect(signal?.aborted).toBe(false);
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });

  it('retains the 15-second deadline for non-shipping status updates', async () => {
    vi.useFakeTimers();
    mocks.fetch.mockReturnValue(new Promise(() => {}));
    let outcome: unknown;
    const result = useOrderStatusMutation()
      .mutate({ orderId: 'order-1', status: 'processing' })
      .catch((error: unknown) => {
        outcome = error;
        return error;
      });
    await vi.advanceTimersByTimeAsync(14999);
    expect(outcome).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toMatchObject({
      message: 'Request timed out. Please check your connection and try again.',
    });
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });

  it('treats Expo native cancellation at the local deadline as unconfirmed, refreshes the order and never retries the booking', async () => {
    vi.useFakeTimers();
    mocks.fetch.mockImplementation(
      (_url, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => {
            reject(
              new Error(
                'fetch failed: FetchRequestCanceledException: Fetch request has been canceled (at Expo/NativeResponse.swift:63)'
              )
            );
          });
        })
    );
    const result = useOrderStatusMutation()
      .mutate({ orderId: 'order-1', status: 'shipped' })
      .catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(30000);
    expect(await result).toMatchObject(unconfirmedOutcome);

    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['order', 'order-1'],
    });
  });

  it('bounds a stalled response body by the original request deadline without restarting it at headers', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    let outcome: unknown;
    const text = vi.fn(() => new Promise<string>(() => {}));
    mocks.fetch.mockImplementation((_url, options: RequestInit) => {
      signal = options.signal;
      return new Promise((resolve) => {
        setTimeout(() => resolve({ ok: true, text }), 10000);
      });
    });
    const result = useOrderStatusMutation()
      .mutate({ orderId: 'order-1', status: 'shipped' })
      .catch((error: unknown) => {
        outcome = error;
        return error;
      });

    await vi.advanceTimersByTimeAsync(10000);
    expect(text).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(19999);
    expect(outcome).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toMatchObject(unconfirmedOutcome);
    expect(await result).toMatchObject(unconfirmedOutcome);
    expect(signal?.aborted).toBe(true);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['order', 'order-1'],
    });
  });

  it('treats response-body loss after successful headers as unconfirmed instead of exposing the native exception', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      text: async () => {
        throw new Error('NativeResponse.swift:63 request canceled');
      },
    });

    await expect(
      useOrderStatusMutation().mutate({ orderId: 'order-1', status: 'shipped' })
    ).rejects.toMatchObject(unconfirmedOutcome);
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });

  it.each([
    'synchronous',
    'rejected',
  ])('preserves a %s session lookup failure without sending a booking', async (failure) => {
    mocks.getSession.mockImplementation(() => {
      const error = new Error('Local session storage failed');
      if (failure === 'synchronous') throw error;
      return Promise.reject(error);
    });

    await expect(
      useOrderStatusMutation().mutate({ orderId: 'order-1', status: 'shipped' })
    ).rejects.toMatchObject({
      name: 'AuthenticatedFetchPreflightError',
      message: 'Could not authenticate request. Please try again.',
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('preserves authentication failures because no booking request was sent', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });

    await expect(
      useOrderStatusMutation().mutate({ orderId: 'order-1', status: 'shipped' })
    ).rejects.toMatchObject({
      name: 'AuthenticatedFetchPreflightError',
      message: 'Not authenticated',
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([
    '',
    '{"order":',
    'null',
    '{"order":null}',
    '{"order":"invalid"}',
    '{"order":{"id":"another-order","shipping_status":"shipped"}}',
    '{"order":{"id":"order-1","shipping_status":"processing"}}',
  ])('does not confirm shipment from an incomplete or mismatched 2xx response: %s', async (body) => {
    mocks.fetch.mockResolvedValue(new Response(body, { status: 200 }));

    await expect(
      useOrderStatusMutation().mutate({ orderId: 'order-1', status: 'shipped' })
    ).rejects.toMatchObject(unconfirmedOutcome);
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });

  it.each([
    [500, '{"error":"Internal server error"}'],
    [502, '<html>Bad gateway</html>'],
    [503, '{"error":"Service unavailable"}'],
    [504, '{"error":"Gateway timed out"}'],
  ])('treats an untyped gateway %i as an unconfirmed shipping outcome without retrying', async (status, body) => {
    mocks.fetch.mockResolvedValue(new Response(body, { status }));

    await expect(
      useOrderStatusMutation().mutate({ orderId: 'order-1', status: 'shipped' })
    ).rejects.toMatchObject(unconfirmedOutcome);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['order', 'order-1'],
    });
  });

  it.each([
    [500, 'SHIPMENT_SAVE_FAILED'],
    [409, 'ORDER_REFUNDED_AFTER_BOOKING'],
    [500, 'SHIPMENT_BOOKING_STATE_CHECK_FAILED'],
    [500, 'MERCHANT_WALLET_COMPLETION_FAILED'],
    [500, 'MERCHANT_WALLET_RECONCILIATION_FAILED'],
    [409, 'MERCHANT_WALLET_BOOKING_NOT_RETRYABLE'],
    [409, 'MERCHANT_WALLET_BOOKED_SHIPMENT_MISSING'],
    [409, 'SHIPMENT_BOOKING_IN_PROGRESS'],
    [404, 'ORDER_NOT_FOUND'],
    [500, 'EXISTING_SHIPMENT_LOOKUP_FAILED'],
    [409, 'INCOMPLETE_EXISTING_SHIPMENT'],
    [409, 'EXISTING_SHIPMENT_PROVIDER_MISMATCH'],
    [409, 'EXISTING_SHIPMENT_QUOTE_MISMATCH'],
    [500, 'MERCHANT_WALLET_SUBMISSION_FAILED'],
    [500, 'MERCHANT_WALLET_REFUND_FAILED'],
    [500, 'SHIPMENT_BOOKING_LOCK_RELEASE_FAILED'],
  ])('treats post-submit or unresolved booking code %s/%s as unconfirmed without retrying', async (status, code) => {
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'Booking outcome requires reconciliation',
          code,
        }),
        { status }
      )
    );
    await expect(
      useOrderStatusMutation().mutate({ orderId: 'order-1', status: 'shipped' })
    ).rejects.toMatchObject(unconfirmedOutcome);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['order', 'order-1'],
    });
  });

  it.each([
    'SHIPMENT_SAVE_FAILED',
    'INTERNAL_ERROR',
  ])('preserves typed code %s outside a shipping request', async (code) => {
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'Original server error',
          code,
        }),
        { status: 500 }
      )
    );
    await expect(
      useOrderStatusMutation().mutate({
        orderId: 'order-1',
        status: 'processing',
      })
    ).rejects.toMatchObject({
      code,
      message: 'Original server error',
    });
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });

  it('preserves an untyped gateway failure for a non-shipping status update', async () => {
    mocks.fetch.mockResolvedValue(
      new Response('{"error":"Service unavailable"}', { status: 503 })
    );

    await expect(
      useOrderStatusMutation().mutate({
        orderId: 'order-1',
        status: 'processing',
      })
    ).rejects.toMatchObject({
      name: 'OrderStatusUpdateError',
      code: undefined,
      message: 'Service unavailable',
    });
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });
});

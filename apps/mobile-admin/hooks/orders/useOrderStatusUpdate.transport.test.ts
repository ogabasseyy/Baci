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

    await vi.advanceTimersByTimeAsync(15000);
    expect(await result).toMatchObject(unconfirmedOutcome);

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
});

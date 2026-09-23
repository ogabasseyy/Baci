import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryClientMock = vi.hoisted(() => ({
  cancelQueries: vi.fn(),
  getQueriesData: vi.fn(),
  invalidateQueries: vi.fn(),
  setQueriesData: vi.fn(),
  setQueryData: vi.fn(),
}));

const networkMock = vi.hoisted(() => ({
  fetch: vi.fn(),
  getSession: vi.fn(),
}));

vi.stubGlobal('fetch', networkMock.fetch);

vi.mock('@/lib/api-client', () => ({
  BASE_URL: 'https://example.test',
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: networkMock.getSession },
  },
}));

vi.mock('../useMerchant', () => ({
  useMerchant: () => ({ merchant: { id: 'merchant-1' } }),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>(
    '@tanstack/react-query'
  );

  return {
    ...actual,
    useMutation: vi.fn((config) => config),
    useQueryClient: () => queryClientMock,
  };
});

import { useUpdateOrderStatus } from './useOrderStatusUpdate';

describe('useUpdateOrderStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClientMock.getQueriesData.mockReturnValue([]);
    networkMock.getSession.mockResolvedValue({ data: { session: null } });
  });

  it('throws auth session errors before patching order status', async () => {
    networkMock.getSession.mockResolvedValue({
      data: { session: { access_token: 'token-1' } },
      error: { message: 'Session lookup failed' },
    });

    const mutation = useUpdateOrderStatus() as unknown as {
      mutationFn: (vars: {
        orderId: string;
        status: string;
      }) => Promise<unknown>;
    };

    await expect(
      mutation.mutationFn({ orderId: 'order-1', status: 'shipped' })
    ).rejects.toThrow('Session lookup failed');
    expect(networkMock.fetch).not.toHaveBeenCalled();
  });

  it('patches order status with the session token and parses the order payload', async () => {
    networkMock.getSession.mockResolvedValue({
      data: { session: { access_token: 'token-1' } },
    });
    networkMock.fetch.mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          order: {
            id: 'order-1',
            shipping_status: 'shipped',
          },
        }),
    });

    const mutation = useUpdateOrderStatus() as unknown as {
      mutationFn: (vars: {
        orderId: string;
        status: string;
      }) => Promise<unknown>;
    };

    await expect(
      mutation.mutationFn({ orderId: 'order-1', status: 'shipped' })
    ).resolves.toEqual({
      id: 'order-1',
      shipping_status: 'shipped',
    });

    expect(networkMock.fetch).toHaveBeenCalledWith(
      'https://example.test/api/orders/order-1',
      expect.objectContaining({
        body: JSON.stringify({
          shipping_status: 'shipped',
        }),
        headers: expect.objectContaining({
          Authorization: 'Bearer token-1',
        }),
        method: 'PATCH',
      })
    );
  });

  it('uses the audited cancellation endpoint instead of the generic patch route', async () => {
    networkMock.getSession.mockResolvedValue({
      data: { session: { access_token: 'token-1' } },
    });
    networkMock.fetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ success: true }),
    });

    const mutation = useUpdateOrderStatus() as unknown as {
      mutationFn: (vars: {
        orderId: string;
        status: string;
      }) => Promise<unknown>;
    };

    await expect(
      mutation.mutationFn({ orderId: 'order-1', status: 'cancelled' })
    ).resolves.toMatchObject({
      id: 'order-1',
      shipping_status: 'cancelled',
    });

    expect(networkMock.fetch).toHaveBeenCalledWith(
      'https://example.test/api/orders/order-1/cancelled',
      expect.objectContaining({
        body: JSON.stringify({
          cancelled_by: 'merchant',
          confirm_cancellation: true,
        }),
        method: 'POST',
      })
    );
  });

  it('preserves wallet booking codes from failed status updates', async () => {
    networkMock.getSession.mockResolvedValue({
      data: { session: { access_token: 'token-1' } },
    });
    networkMock.fetch.mockResolvedValue({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      text: async () =>
        JSON.stringify({
          error: 'Insufficient merchant wallet balance.',
          code: 'MERCHANT_WALLET_INSUFFICIENT',
          availableBalance: 1200,
          chargedAmount: 4500,
          shortfall: 3300,
        }),
    });

    const mutation = useUpdateOrderStatus() as unknown as {
      mutationFn: (vars: {
        orderId: string;
        status: string;
      }) => Promise<unknown>;
    };

    await expect(
      mutation.mutationFn({ orderId: 'order-1', status: 'shipped' })
    ).rejects.toMatchObject({
      name: 'OrderStatusUpdateError',
      code: 'MERCHANT_WALLET_INSUFFICIENT',
      message: 'Insufficient merchant wallet balance.',
    });
  });

  it('throws sanitized API errors from failed status updates', async () => {
    networkMock.getSession.mockResolvedValue({
      data: { session: { access_token: 'token-1' } },
    });
    networkMock.fetch.mockRejectedValue(
      new Error('Cannot ship cancelled order')
    );

    const mutationOptions =
      useUpdateOrderStatus() as unknown as ConstructorParameters<
        typeof MutationObserver
      >[1];
    const mutation = new MutationObserver(
      new QueryClient({
        defaultOptions: { mutations: { retry: 3, retryDelay: 0 } },
      }),
      mutationOptions
    );

    await expect(
      mutation.mutate({ orderId: 'order-1', status: 'shipped' })
    ).rejects.toThrow('Cannot ship cancelled order');
    expect(networkMock.fetch).toHaveBeenCalledOnce();
  });

  it('maps aborted status updates to the timeout message', async () => {
    networkMock.getSession.mockResolvedValue({
      data: { session: { access_token: 'token-1' } },
    });
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    networkMock.fetch.mockRejectedValue(abortError);

    const mutation = useUpdateOrderStatus() as unknown as {
      mutationFn: (vars: {
        orderId: string;
        status: string;
      }) => Promise<unknown>;
    };

    await expect(
      mutation.mutationFn({ orderId: 'order-1', status: 'shipped' })
    ).rejects.toThrow(
      'Request timed out. Please check your connection and try again.'
    );
  });

  it('optimistically updates and rolls back all scoped order detail caches', async () => {
    const mutation = useUpdateOrderStatus() as unknown as {
      onError: (
        error: Error,
        vars: { orderId: string; status: string },
        context?: {
          previousOrderQueries?: [readonly unknown[], unknown][];
          previousOrders?: [readonly unknown[], unknown][];
        }
      ) => void;
      onMutate: (vars: { orderId: string; status: string }) => Promise<{
        previousOrderQueries: [readonly unknown[], unknown][];
        previousOrders: [readonly unknown[], unknown][];
      }>;
      onSettled: (
        data: unknown,
        error: unknown,
        vars: { orderId: string; status: string }
      ) => void;
    };
    const previousOrder = { id: 'order-1', shipping_status: 'pending' };
    const scopedKey = ['order', 'order-1', 'merchant-1', 'branch-1'] as const;

    queryClientMock.getQueriesData
      .mockReturnValueOnce([])
      .mockReturnValueOnce([[scopedKey, previousOrder]]);

    const context = await mutation.onMutate({
      orderId: 'order-1',
      status: 'shipped',
    });

    expect(queryClientMock.cancelQueries).toHaveBeenCalledWith({
      queryKey: ['order', 'order-1'],
    });
    expect(queryClientMock.getQueriesData).toHaveBeenCalledWith({
      queryKey: ['order', 'order-1'],
    });
    expect(queryClientMock.setQueriesData).toHaveBeenCalledWith(
      { queryKey: ['order', 'order-1'] },
      expect.any(Function)
    );

    const detailUpdater = queryClientMock.setQueriesData.mock.calls.find(
      ([filters]) =>
        (filters as { queryKey?: unknown[] }).queryKey?.[0] === 'order'
    )?.[1];

    expect(detailUpdater).toBeDefined();

    const updateDetail = detailUpdater as (
      order: typeof previousOrder
    ) => typeof previousOrder;

    expect(updateDetail(previousOrder)).toEqual({
      id: 'order-1',
      shipping_status: 'shipped',
    });

    mutation.onError(
      new Error('boom'),
      {
        orderId: 'order-1',
        status: 'shipped',
      },
      context
    );

    expect(queryClientMock.setQueryData).toHaveBeenCalledWith(
      scopedKey,
      previousOrder
    );

    mutation.onSettled(null, null, {
      orderId: 'order-1',
      status: 'shipped',
    });

    expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['order', 'order-1'],
    });
    expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['transaction-review', 'merchant-1'],
    });
  });
});

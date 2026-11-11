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

type Variables = {
  orderId: string;
  refund?: 'automatic' | 'manual';
  status: string;
};

type Mutation = { mutationFn: (vars: Variables) => Promise<unknown> };

describe('useUpdateOrderStatus cancellation refund choice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClientMock.getQueriesData.mockReturnValue([]);
    networkMock.getSession.mockResolvedValue({
      data: { session: { access_token: 'token-1' } },
    });
  });

  it('sends the chosen cancellation refund mode to the audited endpoint', async () => {
    networkMock.fetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ success: true }),
    });

    const mutation = useUpdateOrderStatus() as unknown as Mutation;
    await mutation.mutationFn({
      orderId: 'order-1',
      refund: 'manual',
      status: 'cancelled',
    });

    expect(networkMock.fetch).toHaveBeenCalledWith(
      'https://example.test/api/orders/order-1/cancelled',
      expect.objectContaining({
        body: JSON.stringify({
          cancelled_by: 'merchant',
          confirm_cancellation: true,
          refund: 'manual',
        }),
      })
    );
  });

  it('returns the refund outcome the server reports', async () => {
    networkMock.fetch.mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          sideEffects: { refund: 'queued_if_required' },
          success: true,
        }),
    });

    const mutation = useUpdateOrderStatus() as unknown as Mutation;
    await expect(
      mutation.mutationFn({
        orderId: 'order-1',
        refund: 'manual',
        status: 'cancelled',
      })
    ).resolves.toMatchObject({ refund_outcome: 'queued_if_required' });
  });
});

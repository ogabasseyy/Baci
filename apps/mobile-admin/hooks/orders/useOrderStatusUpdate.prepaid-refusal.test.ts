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

  describe('bugfix: pre-submit prepaid/wallet refusal is not an unknown booking state', () => {
    it.each([
      [400],
      [409],
      [500],
    ])('shows the real refusal for GIGL_REQUIRES_PREPAID_OR_WALLET at HTTP %s', async (status) => {
      mocks.fetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            error:
              'GIGL shipping must be prepaid at checkout or funded from the merchant wallet before booking.',
            code: 'GIGL_REQUIRES_PREPAID_OR_WALLET',
          }),
          { status }
        )
      );
      await expect(
        useOrderStatusMutation().mutate({
          orderId: 'order-1',
          status: 'shipped',
        })
      ).rejects.toMatchObject({
        code: 'GIGL_REQUIRES_PREPAID_OR_WALLET',
        message: expect.stringContaining('prepaid at checkout'),
      });
    });
  });
});

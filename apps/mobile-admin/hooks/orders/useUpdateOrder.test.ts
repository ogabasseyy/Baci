import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAuthenticatedFetch: vi.fn(),
  invalidateQueries: vi.fn(),
  useMutation: vi.fn((config) => config),
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: mocks.useMutation,
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
}));

vi.mock('@/lib/api-client', () => ({
  BASE_URL: 'https://api.test',
}));

vi.mock('./authenticated-fetch', () => ({
  createAuthenticatedFetch: mocks.createAuthenticatedFetch,
}));

vi.mock('../useMerchant', () => ({
  useMerchant: () => ({ merchant: { id: 'merchant-1' } }),
}));

import { useUpdateOrder } from './useUpdateOrder';

const payload = {
  branch_id: null,
  customer: {
    email: 'ada@example.com',
    id: 'customer-1',
    name: 'Ada Buyer',
    phone: '+2348012345678',
  },
  discount_amount: 0,
  items: [
    {
      condition: 'new',
      image_url: 'https://example.test/phone.jpg',
      item_description: null,
      name: 'Phone',
      price: 1000,
      product_id: 'product-1',
      product_match_status: 'linked',
      quantity: 1,
      variant_attributes: { color: 'Blue' },
      variant_id: 'variant-1',
      variant_name: 'Blue',
    },
  ],
  notes: null,
  notify_customer: true,
  shipping_address: {
    address: '12 Allen Avenue',
    city: 'Ikeja',
    name: 'Ada Buyer',
    phone: '+2348012345678',
    state: 'Lagos',
  },
  shipping_fee: 0,
  source: 'physical',
  tax_amount: 0,
};

interface UpdateOrderMutationConfig {
  mutationFn: (variables: {
    orderId: string;
    payload: typeof payload;
  }) => Promise<unknown>;
  onSuccess: (
    data: unknown,
    variables: { orderId: string; payload: typeof payload }
  ) => void;
}

describe('useUpdateOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createAuthenticatedFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          edit: { changed_fields: ['items'] },
          order: { id: 'order-1' },
        }),
        {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    );
  });

  it('patches the checked order edit endpoint with the full replacement payload', async () => {
    const mutation = useUpdateOrder() as unknown as UpdateOrderMutationConfig;

    await mutation.mutationFn({ orderId: 'order-1', payload });

    expect(mocks.createAuthenticatedFetch).toHaveBeenCalledWith(
      'https://api.test/api/orders/order-1/edit',
      expect.objectContaining({
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
        method: 'PATCH',
      }),
      15_000
    );
  });

  it('throws the response error when the API rejects the edit', async () => {
    mocks.createAuthenticatedFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Financial edits are locked' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 409,
      })
    );
    const mutation = useUpdateOrder() as unknown as UpdateOrderMutationConfig;

    await expect(
      mutation.mutationFn({ orderId: 'order-1', payload })
    ).rejects.toThrow('Financial edits are locked');
  });

  it('throws when a successful response omits the updated order id', async () => {
    mocks.createAuthenticatedFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ edit: {}, order: {} }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      })
    );
    const mutation = useUpdateOrder() as unknown as UpdateOrderMutationConfig;

    await expect(
      mutation.mutationFn({ orderId: 'order-1', payload })
    ).rejects.toThrow('Failed to update order');
  });

  it('invalidates order, list, dashboard, counts, audit, and review queries after success', () => {
    const mutation = useUpdateOrder() as unknown as UpdateOrderMutationConfig;

    mutation.onSuccess(
      { edit: { changed_fields: [] }, order: { id: 'order-1' } },
      { orderId: 'order-1', payload }
    );

    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['order', 'order-1'],
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['orders', 'merchant-1'],
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['order-audit-events', 'order-1'],
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['dashboard-stats', 'merchant-1'],
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['order-counts', 'merchant-1'],
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['transaction-review', 'merchant-1'],
    });
  });
});

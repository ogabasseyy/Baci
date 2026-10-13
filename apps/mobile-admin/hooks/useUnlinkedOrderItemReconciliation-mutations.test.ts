import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryClientMock = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
}));

const supabaseMock = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: supabaseMock,
}));

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: { id: 'merchant-1' } }),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>(
    '@tanstack/react-query'
  );

  return {
    ...actual,
    useMutation: vi.fn((config) => config),
    useQuery: vi.fn(() => ({})),
    useQueryClient: () => queryClientMock,
  };
});

import { useUnlinkedOrderItemReconciliation } from './useUnlinkedOrderItemReconciliation';

type HookState = {
  keepCustomMutation: {
    mutationFn: (input: { orderItemId: string }) => Promise<void>;
    onSuccess: () => void;
  };
  linkItemMutation: {
    mutationFn: (input: {
      orderItemId: string;
      productId: string;
      variantId: string | null;
    }) => Promise<void>;
    onSuccess: () => void;
  };
};

function getHookState() {
  // biome-ignore lint/correctness/useHookAtTopLevel: test helper invokes the hook outside a component render; @tanstack/react-query hooks are mocked as plain config-capturing functions above, so no real React hook state is involved
  return useUnlinkedOrderItemReconciliation() as unknown as HookState;
}

describe('useUnlinkedOrderItemReconciliation mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMock.rpc.mockResolvedValue({ data: null, error: null });
  });

  it('links an item through the scoped reconciliation RPC', async () => {
    const state = getHookState();

    await state.linkItemMutation.mutationFn({
      orderItemId: 'item-1',
      productId: 'product-1',
      variantId: 'variant-1',
    });

    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      'link_transaction_order_item_product',
      {
        p_merchant_id: 'merchant-1',
        p_order_item_id: 'item-1',
        p_product_id: 'product-1',
        p_variant_id: 'variant-1',
      }
    );

    state.linkItemMutation.onSuccess();
    expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['transaction-review'],
    });
    expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['analytics-detail'],
    });
  });

  it('keeps an unlinked item custom without assigning a product', async () => {
    const state = getHookState();

    await state.keepCustomMutation.mutationFn({ orderItemId: 'item-2' });

    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      'mark_transaction_order_item_custom',
      {
        p_merchant_id: 'merchant-1',
        p_order_item_id: 'item-2',
      }
    );
  });

  it('surfaces a reconciliation RPC error to the caller', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { message: 'reconciliation failed' },
    });
    const state = getHookState();

    await expect(
      state.keepCustomMutation.mutationFn({ orderItemId: 'item-3' })
    ).rejects.toThrow('reconciliation failed');
  });
});

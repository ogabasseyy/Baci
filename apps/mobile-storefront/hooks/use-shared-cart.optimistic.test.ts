import { act, renderHook, waitFor } from '@testing-library/react-native';
import { NativeCartError } from '@/lib/cart/native-cart-error';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import { forwardSharedCartWrite } from '@/stores/shared-cart-writer';
import { useSharedCart } from './use-shared-cart';

const mockWrite = jest.fn();
const mockCart = {
  current: {
    items: [
      { id: 'a', product_id: 'p', slug: 'p', name: 'P', price: 5, quantity: 1 },
    ] as unknown[],
    sharedCartRef: undefined as unknown,
    checkoutGeneration: 'g' as string,
  },
};
jest.mock('@/lib/cart/controller', () => ({
  createNativeCartController: () => ({
    refresh: jest.fn().mockResolvedValue(undefined),
    write: (...args: unknown[]) => mockWrite(...args),
  }),
}));
jest.mock('@/stores/cart-store', () => ({
  useCartStore: {
    getState: () => mockCart.current,
    setState: (next: Record<string, unknown>) => {
      mockCart.current = { ...mockCart.current, ...next };
    },
  },
}));
jest.mock('@/hooks/product-utils', () => ({
  fetchProductRow: jest.fn(),
  transformProduct: jest.fn(),
}));
jest.mock('@/lib/persist-checkout-generation', () => ({
  persistCheckoutGenerationDetached: jest.fn(),
}));
jest.mock('@/lib/release-checkout-credit-snapshot', () => ({
  releaseCheckoutCreditSnapshot: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/release-codepoint-checkout-item-sort', () => ({
  releaseCodepointCheckoutItemSort: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'operation' }));
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'x',
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const options = {
  enabled: true,
  merchantId: '11111111-1111-4111-8111-111111111111',
  merchantSlug: 'shop',
  apiOrigin: 'https://usebaci.com',
  subjectKey: 'guest',
};
const deps = {
  client: jest.fn(() => ({
    context: jest.fn().mockResolvedValue(null),
    bootstrap: jest.fn(),
    read: jest.fn(),
    create: jest.fn(),
    command: jest.fn(),
    recoverCreation: jest.fn(),
  })),
  loadProduct: jest.fn().mockResolvedValue(null),
  receipts: {
    read: jest.fn().mockResolvedValue(null),
    save: jest.fn(),
    clear: jest.fn(),
  },
};
function confirmedCart() {
  useNativeSharedCartStore.setState({
    snapshot: { cartId: 'c', version: 1, lines: [] } as never,
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  mockCart.current.items = [
    { id: 'a', product_id: 'p', slug: 'p', name: 'P', price: 5, quantity: 1 },
  ];
});

it('shows the new quantity at once and keeps the server reply authoritative', async () => {
  let resolveWrite: () => void = () => undefined;
  mockWrite.mockImplementation(
    () => new Promise<void>((resolve) => (resolveWrite = resolve))
  );
  const { unmount } = renderHook(() => useSharedCart(options, deps));
  await waitFor(() => expect(deps.client).toHaveBeenCalled());
  confirmedCart();
  const pending = forwardSharedCartWrite({
    type: 'quantity',
    id: 'a',
    quantity: 3,
  });
  await waitFor(() =>
    expect((mockCart.current.items[0] as { quantity: number }).quantity).toBe(3)
  );
  expect(mockWrite).toHaveBeenCalledTimes(1);
  resolveWrite();
  await pending;
  expect(useNativeSharedCartStore.getState().writeNotice).toBeNull();
  unmount();
});

it('rolls back and explains the rejection', async () => {
  mockWrite.mockRejectedValue(new NativeCartError('invalid_item'));
  const { unmount } = renderHook(() => useSharedCart(options, deps));
  await waitFor(() => expect(deps.client).toHaveBeenCalled());
  confirmedCart();
  const pending = forwardSharedCartWrite({ type: 'remove', id: 'a' });
  await expect(pending).rejects.toBeInstanceOf(NativeCartError);
  expect(mockCart.current.items).toHaveLength(1);
  expect(useNativeSharedCartStore.getState().writeNotice).toMatch(
    /no longer available/i
  );
  act(() => unmount());
});

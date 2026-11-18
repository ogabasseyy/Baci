import { renderHook } from '@testing-library/react-native';
import { useCartStore } from '@/stores/cart-store';
import { useSharedCart } from './use-shared-cart';

const mockOptions: { current: Record<string, (...args: never[]) => void> } = {
  current: {},
};
jest.mock('@/lib/cart/controller', () => ({
  createNativeCartController: (options: Record<string, never>) => {
    mockOptions.current = options;
    return {
      refresh: jest.fn().mockResolvedValue(undefined),
      write: jest.fn().mockResolvedValue(undefined),
      revertPending: () => [{ id: 'confirmed-line' }],
    };
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
  subjectKey: 'user-a',
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
const ref = { merchantId: options.merchantId, cartId: 'cart-1' };

it('restores confirmed lines on teardown for the same shopper', () => {
  useCartStore.setState({ items: [], sharedCartRef: ref });
  const { unmount } = renderHook(() => useSharedCart(options, deps));
  unmount();
  expect(useCartStore.getState().items.map((i) => i.id)).toEqual([
    'confirmed-line',
  ]);
});

it('does not hand the previous account lines to the next identity when sign-out kept the cart reference', () => {
  useCartStore.setState({ items: [], sharedCartRef: ref });
  const { rerender } = renderHook(
    (p: typeof options) => useSharedCart(p, deps),
    { initialProps: options }
  );
  rerender({ ...options, subjectKey: 'user-b' });
  expect(useCartStore.getState().items).toEqual([]);
});

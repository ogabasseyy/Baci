import { renderHook, waitFor } from '@testing-library/react-native';
import { NativeCartError } from '@/lib/cart/native-cart-error';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
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
const report = (...args: unknown[]) =>
  (mockOptions.current.onWriteFailed as (...a: unknown[]) => void)(...args);
const notice = () => useNativeSharedCartStore.getState().writeNotice;

beforeEach(() => useNativeSharedCartStore.setState({ writeNotice: null }));

it('explains a rejected shopper edit app-wide', async () => {
  const { unmount } = renderHook(() => useSharedCart(options, deps));
  await waitFor(() => expect(deps.client).toHaveBeenCalled());
  report({ type: 'add' }, new NativeCartError('invalid_item'), 'rolled_back');
  expect(notice()).toMatch(/no longer available/i);
  unmount();
});

it('says still saving for an uncertain failure', async () => {
  const { unmount } = renderHook(() => useSharedCart(options, deps));
  await waitFor(() => expect(deps.client).toHaveBeenCalled());
  report(
    { type: 'quantity' },
    new NativeCartError('network', true),
    'unconfirmed'
  );
  expect(notice()).toMatch(/still saving/i);
  unmount();
});

it('stays silent when background repricing fails', async () => {
  const { unmount } = renderHook(() => useSharedCart(options, deps));
  await waitFor(() => expect(deps.client).toHaveBeenCalled());
  report(
    { type: 'legacy_reprice' },
    new NativeCartError('invalid_item'),
    'rolled_back'
  );
  expect(notice()).toBeNull();
  unmount();
});

it('drops predicted lines left behind when the controller is torn down', async () => {
  const { useCartStore } = jest.requireActual('@/stores/cart-store');
  const { unmount } = renderHook(() => useSharedCart(options, deps));
  await waitFor(() => expect(deps.client).toHaveBeenCalled());
  useCartStore.setState({
    items: [
      {
        id: 'pending-line::1',
        product_id: 'p',
        slug: 'p',
        name: 'P',
        price: 1,
        quantity: 1,
      },
      {
        id: 'real',
        product_id: 'q',
        slug: 'q',
        name: 'Q',
        price: 1,
        quantity: 1,
      },
    ],
  });
  unmount();
  expect(
    useCartStore.getState().items.map((i: { id: string }) => i.id)
  ).toEqual(['real']);
});

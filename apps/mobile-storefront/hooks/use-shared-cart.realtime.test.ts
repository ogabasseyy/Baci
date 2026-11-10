import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import { useSharedCart } from './use-shared-cart';

const mockStart = jest.fn();
jest.mock('@/lib/cart/shared-cart-realtime', () => ({
  startSharedCartRealtime: (...args: unknown[]) => mockStart(...args),
}));
const mockLegacyCart = {
  current: {
    items: [] as unknown[],
    sharedCartRef: undefined as unknown,
    checkoutGeneration: 'generation-initial' as string,
  },
};
jest.mock('@/stores/cart-store', () => ({
  useCartStore: {
    getState: () => mockLegacyCart.current,
    setState: (next: Record<string, unknown>) => {
      mockLegacyCart.current = { ...mockLegacyCart.current, ...next };
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
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('@/lib/supabase', () => ({
  ...jest.requireActual('@/lib/supabase'),
  getSupabaseRealtimeConfig: () => ({ url: 'https://p.test', key: 'k' }),
}));
jest.mock('@/lib/cart/shared-cart-realtime-transport', () => ({
  createNativeRealtimeDeps: jest.fn(() => ({})),
}));

const options = {
  enabled: true,
  realtimeEnabled: true,
  merchantId: '11111111-1111-4111-8111-111111111111',
  merchantSlug: 'shop',
  apiOrigin: 'https://usebaci.com',
  subjectKey: 'guest',
};
function makeDeps() {
  const client = {
    context: jest.fn().mockResolvedValue(null),
    bootstrap: jest.fn(),
    read: jest.fn(),
    create: jest.fn(),
    command: jest.fn(),
    recoverCreation: jest.fn(),
  };
  return {
    client: jest.fn(() => client),
    loadProduct: jest.fn().mockResolvedValue(null),
    receipts: {
      read: jest.fn().mockResolvedValue(null),
      save: jest.fn(),
      clear: jest.fn(),
    },
  };
}
const handle = { sync: jest.fn(), stop: jest.fn() };
beforeEach(() => {
  jest.clearAllMocks();
  mockStart.mockReturnValue(handle);
});

it('starts realtime only when the merchant flag is on and stops it on unmount', async () => {
  const { unmount } = renderHook(() => useSharedCart(options, makeDeps()));
  await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
  expect(mockStart.mock.calls[0][0]).toMatchObject({
    merchantId: options.merchantId,
  });
  unmount();
  expect(handle.stop).toHaveBeenCalledTimes(1);
});

it('does not open a push channel when realtime is not enabled', async () => {
  const { unmount } = renderHook(() =>
    useSharedCart({ ...options, realtimeEnabled: false }, makeDeps())
  );
  await act(async () => undefined);
  expect(mockStart).not.toHaveBeenCalled();
  unmount();
});

it('stops realtime when enrollment is turned off and on merchant change', async () => {
  const deps = makeDeps();
  const { rerender } = renderHook(
    (p: typeof options) => useSharedCart(p, deps),
    { initialProps: options }
  );
  await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
  rerender({ ...options, merchantId: '22222222-2222-4222-8222-222222222222' });
  await waitFor(() => expect(handle.stop).toHaveBeenCalledTimes(1));
  expect(mockStart).toHaveBeenCalledTimes(2);
  rerender({ ...options, enabled: false });
  await waitFor(() => expect(handle.stop).toHaveBeenCalledTimes(2));
});

it('re-syncs the channel when the cart id changes', async () => {
  const { unmount } = renderHook(() => useSharedCart(options, makeDeps()));
  await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
  act(() => {
    useNativeSharedCartStore.setState({
      snapshot: {
        cartId: '33333333-3333-4333-8333-333333333333',
        version: 1,
      } as never,
    });
  });
  expect(handle.sync).toHaveBeenCalled();
  unmount();
});

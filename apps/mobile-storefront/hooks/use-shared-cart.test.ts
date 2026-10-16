import { act, renderHook, waitFor } from '@testing-library/react-native';
import { NativeCartError } from '@/lib/cart/native-cart-error';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import {
  hasSharedCartWriter,
  retireSharedCartWriter,
} from '@/stores/shared-cart-writer';
import { useSharedCart } from './use-shared-cart';

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
it('installs one owner only in enabled mode and fences late callbacks on cleanup', async () => {
  const client = {
    context: jest.fn().mockResolvedValue(null),
    bootstrap: jest.fn(),
    read: jest.fn(),
    create: jest.fn(),
    command: jest.fn(),
    recoverCreation: jest.fn(),
  };
  const deps = {
    client: jest.fn(() => client),
    loadProduct: jest.fn().mockResolvedValue(null),
    receipts: {
      read: jest.fn().mockResolvedValue(null),
      save: jest.fn(),
      clear: jest.fn(),
    },
  };
  const { rerender, unmount } = renderHook(
    (p: typeof options) => useSharedCart(p, deps),
    { initialProps: { ...options, enabled: false } }
  );
  expect(hasSharedCartWriter()).toBe(false);
  await act(async () => rerender(options));
  await waitFor(() => expect(client.context).toHaveBeenCalled());
  expect(hasSharedCartWriter()).toBe(true);
  unmount();
  expect(hasSharedCartWriter()).toBe(false);
});

it('discards canonical ownership when enrollment turns off', async () => {
  mockLegacyCart.current = {
    items: [{ id: 'item-1' }],
    checkoutGeneration: 'generation-old',
    sharedCartRef: {
      merchantId: options.merchantId,
      cartId: '22222222-2222-4222-8222-222222222222',
    },
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
  const SecureStore = jest.requireMock('expo-secure-store') as {
    deleteItemAsync: jest.Mock;
  };
  SecureStore.deleteItemAsync.mockClear();
  const { rerender } = renderHook(
    (p: typeof options) => useSharedCart(p, deps),
    { initialProps: { ...options, enabled: false } }
  );
  expect(mockLegacyCart.current.sharedCartRef).toBeUndefined();
  expect(mockLegacyCart.current.items).toEqual([]);
  // The abandoned canonical generation is rotated so the next legacy
  // cart cannot inherit its frozen credit choices or order attempt.
  expect(mockLegacyCart.current.checkoutGeneration).not.toBe('generation-old');
  // An initial disabled mount (enrollment still loading) must not
  // retire the persisted session before the real merchant record lands.
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalledWith(
    `baci.cart.session.${options.merchantId}`
  );
  // After a committed enabled period, turning enrollment off retires
  // the secure record so a later no-writer sign-out cannot strand it.
  await act(async () => rerender(options));
  await act(async () => rerender({ ...options, enabled: false }));
  await waitFor(() =>
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
      `baci.cart.session.${options.merchantId}`
    )
  );
});

it('surfaces an initial refresh failure as an error state for retry', async () => {
  const deps = {
    client: jest.fn(() => ({
      context: jest.fn().mockRejectedValue(new Error('offline')),
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
  const { unmount } = renderHook(() => useSharedCart(options, deps));
  await waitFor(() =>
    expect(useNativeSharedCartStore.getState().status).toBe('error')
  );
  expect(useNativeSharedCartStore.getState().code).toBe(
    'temporarily_unavailable'
  );
  expect(useNativeSharedCartStore.getState().snapshot).toBeNull();
  unmount();
});

it('clears a pending receipt even when local retirement defers remote revocation', async () => {
  const deps = {
    client: jest.fn(() => ({
      context: jest.fn().mockResolvedValue(null),
      bootstrap: jest.fn(),
      read: jest.fn(),
      create: jest.fn(),
      command: jest.fn(),
      recoverCreation: jest.fn(),
      retireDevice: jest
        .fn()
        .mockRejectedValue(new NativeCartError('revocation_pending')),
    })),
    loadProduct: jest.fn().mockResolvedValue(null),
    receipts: {
      read: jest.fn().mockResolvedValue({ operationId: 'pending' }),
      save: jest.fn(),
      clear: jest.fn(),
    },
  };
  const { unmount } = renderHook(() => useSharedCart(options, deps));
  await expect(retireSharedCartWriter()).rejects.toMatchObject({
    code: 'revocation_pending',
  });
  expect(deps.receipts.clear).toHaveBeenCalledWith(
    options.merchantId,
    'pending'
  );
  unmount();
});

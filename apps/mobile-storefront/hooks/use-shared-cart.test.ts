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
    getItemAsync: jest.Mock;
    setItemAsync: jest.Mock;
  };
  SecureStore.deleteItemAsync.mockClear();
  SecureStore.setItemAsync.mockClear();
  SecureStore.getItemAsync.mockResolvedValue('cp1.fixture.proof');
  const { rerender } = renderHook(
    (p: typeof options) => useSharedCart(p, deps),
    { initialProps: { ...options, enabled: false } }
  );
  // A placeholder disabled mount (enrollment still loading) must not
  // retire the persisted cart before the real merchant record lands.
  expect(mockLegacyCart.current.sharedCartRef).toBeDefined();
  expect(mockLegacyCart.current.items).toEqual([{ id: 'item-1' }]);
  expect(mockLegacyCart.current.checkoutGeneration).toBe('generation-old');
  // An initial disabled mount (enrollment still loading) must not
  // retire the persisted session before the real merchant record lands.
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalledWith(
    `baci.cart.session.${options.merchantId}`
  );
  // After a committed enabled period, turning enrollment off retires
  // the secure record so a later no-writer sign-out cannot strand it.
  await act(async () => rerender(options));
  await act(async () => rerender({ ...options, enabled: false }));
  // Enrollment-off retires (tombstones) the secure record instead of
  // deleting it, so the proof survives for the next establishment's
  // server revocation flush.
  await waitFor(() =>
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      `baci.cart.session.${options.merchantId}`,
      expect.stringContaining('"retired":true')
    )
  );
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalledWith(
    `baci.cart.session.${options.merchantId}`
  );
  // The committed disable retires the canonical reference and rotates
  // its checkout generation.
  expect(mockLegacyCart.current.sharedCartRef).toBeUndefined();
  expect(mockLegacyCart.current.items).toEqual([]);
  expect(mockLegacyCart.current.checkoutGeneration).not.toBe('generation-old');
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

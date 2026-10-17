import { cartSessionStorage } from '@/lib/cart/session-storage';
import { useCartStore } from './cart-store';
import { clearDeviceCartForAccountTeardown } from './clear-device-cart';
import { installSharedCartWriter } from './shared-cart-writer';

jest.mock('expo-crypto', () => ({
  randomUUID: () => '11111111-1111-4111-8111-111111111111',
}));
jest.mock('@/lib/cart/session-storage', () => ({
  cartSessionStorage: {
    remove: jest.fn().mockResolvedValue(undefined),
    retire: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('@/lib/persist-checkout-generation', () => ({
  persistCheckoutGenerationDetached: jest.fn(),
}));
jest.mock('./cart-store', () => ({
  useCartStore: { getState: jest.fn(), setState: jest.fn() },
}));
jest.mock('./native-shared-cart-store', () => ({
  useNativeSharedCartStore: { setState: jest.fn() },
}));
it('retires the shared reference and stored proof when no writer is mounted', async () => {
  const clearCart = jest.fn().mockResolvedValue(undefined);
  jest.mocked(useCartStore.getState).mockReturnValue({
    clearCart,
    sharedCartRef: {
      merchantId: '11111111-1111-4111-8111-111111111111',
      cartId: '22222222-2222-4222-8222-222222222222',
      version: 1,
    },
  } as never);
  await clearDeviceCartForAccountTeardown();
  expect(clearCart).toHaveBeenCalledTimes(1);
  expect(useCartStore.setState).toHaveBeenCalledWith({
    sharedCartRef: undefined,
  });
  expect(cartSessionStorage.retire).toHaveBeenCalledWith(
    '11111111-1111-4111-8111-111111111111'
  );
  expect(cartSessionStorage.remove).not.toHaveBeenCalled();
});
it('propagates a writer retire failure without erasing the merchant reference', async () => {
  jest.mocked(useCartStore.setState).mockClear();
  const write = jest.fn();
  const retire = jest.fn().mockRejectedValue(new Error('offline'));
  const release = installSharedCartWriter({
    write,
    retire,
    onError: jest.fn(),
  });
  try {
    await expect(clearDeviceCartForAccountTeardown()).rejects.toThrow(
      'offline'
    );
    expect(write).not.toHaveBeenCalled();
    // The merchant reference survives so a retry can find the proof.
    expect(useCartStore.setState).not.toHaveBeenCalledWith(
      expect.objectContaining({ sharedCartRef: undefined })
    );
  } finally {
    release();
  }
});

it('propagates a retire failure instead of reporting teardown success', async () => {
  const { cartSessionStorage } = jest.requireMock(
    '@/lib/cart/session-storage'
  ) as {
    cartSessionStorage: { retire: jest.Mock };
  };
  cartSessionStorage.retire.mockRejectedValueOnce(new Error('storage down'));
  useCartStore.setState({
    clearCart: jest.fn(),
    sharedCartRef: {
      merchantId: '11111111-1111-4111-8111-111111111111',
      cartId: '22222222-2222-4222-8222-222222222222',
    },
  } as never);
  await expect(clearDeviceCartForAccountTeardown()).rejects.toThrow(
    'storage down'
  );
  // The merchant reference survives so a retry can find it.
  expect(useCartStore.getState().sharedCartRef).toMatchObject({
    merchantId: '11111111-1111-4111-8111-111111111111',
    cartId: '22222222-2222-4222-8222-222222222222',
  });
});

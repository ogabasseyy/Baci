import { useCartStore } from './cart-store';
import { clearDeviceCartForAccountTeardown } from './clear-device-cart';
import { installSharedCartWriter } from './shared-cart-writer';

jest.mock('expo-crypto', () => ({
  randomUUID: () => '11111111-1111-4111-8111-111111111111',
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
it('clears private local state even offline without sending a shared-cart clear command', async () => {
  const write = jest.fn();
  const retire = jest.fn().mockRejectedValue(new Error('offline'));
  const release = installSharedCartWriter({
    write,
    retire,
    onError: jest.fn(),
  });
  await expect(clearDeviceCartForAccountTeardown()).rejects.toThrow('offline');
  expect(write).not.toHaveBeenCalled();
  expect(useCartStore.setState).toHaveBeenCalledWith(
    expect.objectContaining({ items: [], sharedCartRef: undefined })
  );
  release();
});

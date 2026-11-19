import { router } from 'expo-router';
import { useCartStore } from '@/stores/cart-store';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import { clearAndPersistCheckoutCart } from './checkout-cart-persistence';
import { completeOxygenCheckout } from './complete-oxygen-checkout';
import { cartItem, generation } from './use-checkout-submit.setup';

jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
jest.mock('@/stores/cart-store', () => ({
  useCartStore: { getState: jest.fn() },
}));
jest.mock('@/stores/native-shared-cart-store', () => ({
  useNativeSharedCartStore: { getState: jest.fn() },
}));
jest.mock('./checkout-cart-persistence', () => ({
  clearAndPersistCheckoutCart: jest.fn(),
}));

const args = {
  generation,
  clearCart: jest.fn(),
  itemsSnapshot: [cartItem],
  orderId: 'order-id',
};
const localCart = {
  items: args.itemsSnapshot,
  checkoutGeneration: generation,
} as ReturnType<typeof useCartStore.getState>;
const localMode = { enabled: false } as ReturnType<
  typeof useNativeSharedCartStore.getState
>;
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(useCartStore.getState).mockReturnValue(localCart);
  jest.mocked(useNativeSharedCartStore.getState).mockReturnValue(localMode);
});

it('persists the emptied submitted cart before opening the pending order', async () => {
  let finish: () => void = () => undefined;
  jest.mocked(clearAndPersistCheckoutCart).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const completing = completeOxygenCheckout(args);
  expect(clearAndPersistCheckoutCart).toHaveBeenCalledWith(args.clearCart);
  expect(router.replace).not.toHaveBeenCalled();
  finish();
  await completing;
  expect(router.replace).toHaveBeenCalledWith({
    pathname: '/oxygen-checkout',
    params: { orderId: args.orderId },
  });
});

it('clears the submitted generation when its items are rehydrated with identical values', async () => {
  jest.mocked(useCartStore.getState).mockReturnValue({
    ...localCart,
    items: args.itemsSnapshot.map((item) => ({ ...item })),
  });

  await completeOxygenCheckout(args);

  expect(clearAndPersistCheckoutCart).toHaveBeenCalledWith(args.clearCart);
  expect(router.replace).toHaveBeenCalledTimes(1);
});

it.each([
  { checkoutGeneration: 'new-generation' },
  { items: [{ ...cartItem, quantity: 2 }] },
])('preserves a cart that changed during submission', async (change) => {
  jest
    .mocked(useCartStore.getState)
    .mockReturnValue({ ...localCart, ...change });
  await completeOxygenCheckout(args);
  expect(clearAndPersistCheckoutCart).not.toHaveBeenCalled();
  expect(router.replace).toHaveBeenCalledTimes(1);
});

it('refreshes a bound cart already finalized by the server', async () => {
  const refresh = jest.fn().mockResolvedValue(undefined);
  jest.mocked(useNativeSharedCartStore.getState).mockReturnValue({
    ...localMode,
    enabled: true,
    refresh,
  });
  await completeOxygenCheckout({
    ...args,
    sharedCartBinding: {
      cart_id: 'cart',
      cart_version: 1,
      checkout_generation: 1,
      checkout_session_id: 'session',
    },
  });
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(clearAndPersistCheckoutCart).not.toHaveBeenCalled();
  expect(router.replace).toHaveBeenCalledTimes(1);
});

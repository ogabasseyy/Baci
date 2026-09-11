import { asyncStorage as AsyncStorage } from '@/lib/storage';
import { useCartStore } from '@/stores/cart-store';

export async function clearAndPersistCheckoutCart(
  clearCart: () => void | Promise<void>
) {
  await clearCart();
  const persistOpts = useCartStore.persist.getOptions();
  const partialize = persistOpts.partialize ?? ((state: unknown) => state);
  const persistedState = partialize(useCartStore.getState());
  const storageKey = persistOpts.name ?? 'cart-storage';
  try {
    await AsyncStorage.setItem(
      storageKey,
      JSON.stringify({
        state: persistedState,
        version: persistOpts.version ?? 0,
      })
    );
  } catch (error) {
    if (__DEV__) {
      console.warn(
        '[checkout-cart-persistence] Failed to persist cleared cart',
        {
          error,
          storageKey,
        }
      );
    }
  }
}

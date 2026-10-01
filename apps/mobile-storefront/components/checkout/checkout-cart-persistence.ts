import { asyncStorage as AsyncStorage } from '@/lib/storage';
import { useCartStore } from '@/stores/cart-store';

export async function clearAndPersistCheckoutCart(
  clearCart: () => void | Promise<void>
) {
  const clearing = clearCart();
  // Persist as soon as the cart is empty instead of waiting for clearCart's
  // background recovery cleanup: on slow storage those awaits would delay
  // this write for seconds, widening the crash window in which startup
  // could reload the purchased items under the new generation and create
  // a duplicate order on resubmit. Falls back to clearCart settling so a
  // cart that never empties cannot hang this helper.
  let unsubscribe: (() => void) | undefined;
  try {
    const emptied = new Promise<void>((resolve) => {
      if (useCartStore.getState().items.length === 0) {
        resolve();
        return;
      }
      unsubscribe = useCartStore.subscribe((state) => {
        if (state.items.length === 0) {
          resolve();
        }
      });
      if (useCartStore.getState().items.length === 0) {
        resolve();
      }
    });
    await Promise.race([
      emptied,
      Promise.resolve(clearing).then(
        () => undefined,
        () => undefined
      ),
    ]);
  } finally {
    unsubscribe?.();
  }
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
  await clearing;
}

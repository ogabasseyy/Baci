import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { prepareCartCheckout } from '@/lib/cart/prepare-cart-checkout';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';

/** One shopper checkout intent at a time, including recovery and navigation. */
export function useCartCheckoutRecovery(onReady: () => void) {
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return async () => {
    if (pending.current) return;
    pending.current = true;
    try {
      const result = await prepareCartCheckout(
        useNativeSharedCartStore.getState
      );
      if (!mounted.current) return;
      if (result.ready) onReadyRef.current();
      else if (result.reason === 'choice_required')
        Alert.alert(
          'Choose your cart',
          'Choose whether to combine your carts or use the saved cart, then tap Checkout again.'
        );
      else if (result.reason !== 'session_changed')
        Alert.alert(
          'Could not sync cart',
          'Your items are still saved. Check your connection and tap Checkout to retry.'
        );
    } finally {
      pending.current = false;
    }
  };
}

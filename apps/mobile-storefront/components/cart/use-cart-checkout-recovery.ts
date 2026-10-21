import { useIsFocused } from 'expo-router';
import { useLayoutEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useAuthStatus } from '@/hooks/use-auth-guard';
import {
  cartPairingRevision,
  peekCartPairingLink,
} from '@/lib/cart/pairing-link';
import { prepareCartCheckout } from '@/lib/cart/prepare-cart-checkout';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import { sharedCartWriteRevision } from '@/stores/shared-cart-writer';

/** One shopper checkout intent at a time, including recovery and navigation. */
export function useCartCheckoutRecovery(onReady: () => void) {
  const onReadyRef = useRef(onReady);
  useLayoutEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);
  const pending = useRef(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const isFocused = useIsFocused();
  const focused = useRef(isFocused);
  useLayoutEffect(() => {
    focused.current = isFocused;
  }, [isFocused]);
  // Controller replacement lags auth in passive effects, so compare the
  // commit-synchronous session against the one captured at tap time.
  const { user } = useAuthStatus();
  const session = useRef(user?.id ?? 'guest');
  useLayoutEffect(() => {
    session.current = user?.id ?? 'guest';
  }, [user]);
  const recoverCheckout = async () => {
    if (pending.current) return;
    pending.current = true;
    setIsPreparing(true);
    const writeRevision = sharedCartWriteRevision();
    const pairingRevision = cartPairingRevision();
    const sessionAtStart = session.current;
    try {
      const result = await prepareCartCheckout(
        useNativeSharedCartStore.getState
      );
      if (!mounted.current || !focused.current) return;
      if (session.current !== sessionAtStart) {
        Alert.alert(
          'Cart session changed',
          'Your account or store changed. Tap Checkout again to continue with your current cart.'
        );
        return;
      }
      if (pairingRevision !== cartPairingRevision() || peekCartPairingLink()) {
        Alert.alert(
          'Choose your cart',
          'Review or close the incoming cart link, then tap Checkout again.'
        );
        return;
      }
      if (writeRevision !== sharedCartWriteRevision()) {
        Alert.alert(
          'Cart changed',
          'Your cart was updated during sync. Review your items and tap Checkout again.'
        );
        return;
      }
      if (result.ready) onReadyRef.current();
      else if (result.reason === 'cart_changed')
        Alert.alert(
          'Cart changed',
          'Your cart was updated during sync. Review your items and tap Checkout again.'
        );
      else if (result.reason === 'choice_required')
        Alert.alert(
          'Choose your cart',
          'Choose whether to combine your carts or use the saved cart, then tap Checkout again.'
        );
      else if (result.reason === 'session_changed')
        Alert.alert(
          'Cart session changed',
          'Your account or store changed. Tap Checkout again to continue with your current cart.'
        );
      else
        Alert.alert(
          'Could not sync cart',
          'Your items are still saved. Check your connection and tap Checkout to retry.'
        );
    } catch {
      // Throws outside prepareCartCheckout (state reads, navigation) must
      // still give the shopper retry guidance instead of a silent dead tap.
      if (!mounted.current || !focused.current) return;
      Alert.alert(
        'Could not sync cart',
        'Your items are still saved. Check your connection and tap Checkout to retry.'
      );
    } finally {
      pending.current = false;
      if (mounted.current) setIsPreparing(false);
    }
  };
  return { recoverCheckout, isPreparing };
}

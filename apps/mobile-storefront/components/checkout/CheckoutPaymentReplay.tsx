import { useIsFocused } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { startCheckoutReplay } from '@/services/checkout-replay';

export function CheckoutPaymentReplay() {
  const isFocused = useIsFocused();

  useEffect(() => {
    if (!isFocused) return;
    let stop: (() => void) | undefined;
    function update(state: typeof AppState.currentState) {
      if (state === 'active') {
        stop ??= startCheckoutReplay();
      } else {
        stop?.();
        stop = undefined;
      }
    }

    const subscription = AppState.addEventListener('change', update);
    update(AppState.currentState);
    return () => {
      subscription.remove();
      stop?.();
    };
  }, [isFocused]);

  return null;
}

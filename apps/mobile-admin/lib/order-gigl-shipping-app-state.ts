import { AppState } from 'react-native';
import type { OrderGiglShippingState } from './order-gigl-shipping-state';

type MutableRef<T> = { current: T };

export function bindOrderGiglShippingAppState(input: {
  appActiveRef: MutableRef<boolean>;
  enabledRef: MutableRef<boolean>;
  quoteRef: MutableRef<unknown>;
  requestQuoteRef: MutableRef<(() => Promise<unknown>) | null>;
  stopPolling: () => void;
  setState: (
    value:
      | OrderGiglShippingState
      | ((previous: OrderGiglShippingState) => OrderGiglShippingState)
  ) => void;
}) {
  return AppState.addEventListener('change', (nextState) => {
    input.appActiveRef.current = nextState === 'active';
    if (!input.appActiveRef.current) {
      input.stopPolling();
      input.setState((previous) =>
        previous === 'loading' || previous === 'polling' ? 'ready' : previous
      );
      return;
    }
    if (input.enabledRef.current && !input.quoteRef.current) {
      void input.requestQuoteRef.current?.();
    }
  });
}

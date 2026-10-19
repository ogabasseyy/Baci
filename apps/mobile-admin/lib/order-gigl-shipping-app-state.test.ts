import { AppState } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import { bindOrderGiglShippingAppState } from './order-gigl-shipping-app-state';

describe('bindOrderGiglShippingAppState', () => {
  it('stops polling when the app backgrounds', () => {
    const listeners = new Map<string, (state: string) => void>();
    vi.spyOn(AppState, 'addEventListener').mockImplementation(
      (event, handler) => {
        listeners.set(event, handler as (state: string) => void);
        return { remove: vi.fn() } as never;
      }
    );
    const stopPolling = vi.fn();
    const setState = vi.fn();
    bindOrderGiglShippingAppState({
      appActiveRef: { current: true },
      enabledRef: { current: true },
      quoteRef: { current: { price: 1 } },
      requestQuoteRef: { current: null },
      stopPolling,
      setState,
    });
    listeners.get('change')?.('background');
    expect(stopPolling).toHaveBeenCalledOnce();
    expect(setState).toHaveBeenCalledOnce();
  });
});

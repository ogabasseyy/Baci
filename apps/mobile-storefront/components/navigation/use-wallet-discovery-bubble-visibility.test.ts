import { act, renderHook } from '@testing-library/react-native';
import { useWalletDiscoveryBubbleVisibility } from './use-wallet-discovery-bubble-visibility';

it('collapses the touch reserve when the bubble is no longer mounted', () => {
  const { result, rerender } = renderHook(
    ({ enabled }: { enabled: boolean }) =>
      useWalletDiscoveryBubbleVisibility(enabled),
    { initialProps: { enabled: true } }
  );

  act(() => result.current.onVisibilityChange(true));
  expect(result.current.reserveTouchSpace).toBe(true);

  rerender({ enabled: false });
  expect(result.current.reserveTouchSpace).toBe(false);
});

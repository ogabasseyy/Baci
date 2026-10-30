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

it('does not restore stale bubble visibility when the bubble is enabled again', () => {
  const { result, rerender } = renderHook(
    ({ enabled }: { enabled: boolean }) =>
      useWalletDiscoveryBubbleVisibility(enabled),
    { initialProps: { enabled: true } }
  );

  act(() => result.current.onVisibilityChange(true));
  expect(result.current.reserveTouchSpace).toBe(true);

  rerender({ enabled: false });
  expect(result.current.reserveTouchSpace).toBe(false);

  rerender({ enabled: true });
  expect(result.current.reserveTouchSpace).toBe(false);

  act(() => result.current.onVisibilityChange(true));
  expect(result.current.reserveTouchSpace).toBe(true);
});

it('keeps visibility false when disabled bubble callbacks report either state', () => {
  const { result, rerender } = renderHook(
    ({ enabled }: { enabled: boolean }) =>
      useWalletDiscoveryBubbleVisibility(enabled),
    { initialProps: { enabled: true } }
  );

  act(() => result.current.onVisibilityChange(true));
  rerender({ enabled: false });

  act(() => result.current.onVisibilityChange(true));
  expect(result.current.reserveTouchSpace).toBe(false);

  rerender({ enabled: true });
  expect(result.current.reserveTouchSpace).toBe(false);
});

it('starts collapsed when initially disabled and resets after repeated toggles', () => {
  const { result, rerender } = renderHook(
    ({ enabled }: { enabled: boolean }) =>
      useWalletDiscoveryBubbleVisibility(enabled),
    { initialProps: { enabled: false } }
  );

  expect(result.current.reserveTouchSpace).toBe(false);
  rerender({ enabled: true });
  expect(result.current.reserveTouchSpace).toBe(false);

  act(() => result.current.onVisibilityChange(true));
  expect(result.current.reserveTouchSpace).toBe(true);

  rerender({ enabled: false });
  rerender({ enabled: true });
  expect(result.current.reserveTouchSpace).toBe(false);
});

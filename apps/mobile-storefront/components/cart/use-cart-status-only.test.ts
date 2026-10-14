import { act, renderHook } from '@testing-library/react-native';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import { useCartStatusOnly } from './use-cart-status-only';

it.each([
  [false, 'choice_required', 0, false],
  [true, 'choice_required', 1, true],
  [true, 'loading', 0, true],
  [true, 'loading', 1, false],
  [true, 'ready', 0, false],
] as const)('uses enabled=%s, status=%s and count=%s to select the cart screen', (enabled, status, count, expected) => {
  useNativeSharedCartStore.setState({ enabled, status });
  const { result } = renderHook(() => useCartStatusOnly(count));
  expect(result.current).toBe(expected);
});
it('reacts to activation even when the status is unchanged', () => {
  useNativeSharedCartStore.setState({
    enabled: false,
    status: 'choice_required',
  });
  const { result } = renderHook(() => useCartStatusOnly(1));
  expect(result.current).toBe(false);
  act(() => useNativeSharedCartStore.setState({ enabled: true }));
  expect(result.current).toBe(true);
});

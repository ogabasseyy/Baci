import { act, renderHook } from '@testing-library/react-native';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import { useCartStatusOnly } from './use-cart-status-only';

const completeSnapshot = { cartId: 'cart-1', lines: [] } as never;

it.each([
  [false, 'choice_required', 0, false],
  [true, 'choice_required', 1, true],
  [true, 'loading', 0, true],
  [true, 'loading', 1, false],
  [true, 'ready', 0, false],
] as const)('uses enabled=%s, status=%s and count=%s to select the cart screen', (enabled, status, count, expected) => {
  useNativeSharedCartStore.setState({
    enabled,
    status,
    snapshot: completeSnapshot,
    metadataReady: true,
    mergeConflicts: [],
  });
  const { result } = renderHook(() => useCartStatusOnly(count));
  expect(result.current).toBe(expected);
});
it('stays status-only while a ready cart still lacks metadata, but not for an empty no-cart state', () => {
  useNativeSharedCartStore.setState({
    enabled: true,
    status: 'ready',
    snapshot: completeSnapshot,
    metadataReady: false,
    mergeConflicts: [],
  });
  const { result } = renderHook(() => useCartStatusOnly(0));
  expect(result.current).toBe(true);
  act(() =>
    useNativeSharedCartStore.setState({ snapshot: null, metadataReady: true })
  );
  // Ready with no server cart and no items is the normal empty-cart
  // view, so the account panel can mount and offer a saved cart.
  expect(result.current).toBe(false);
  act(() => useNativeSharedCartStore.setState({ snapshot: completeSnapshot }));
  expect(result.current).toBe(false);
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

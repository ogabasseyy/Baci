import { fireEvent, render } from '@testing-library/react-native';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import { SharedCartStatusPanel } from './SharedCartStatusPanel';

const productId = '33333333-3333-4333-8333-333333333333';
beforeEach(() => {
  useNativeSharedCartStore.setState({
    enabled: true,
    status: 'error',
    snapshot: null,
    metadataReady: false,
    mergeConflicts: [],
    mergeConflictReason: undefined,
    refresh: null,
    prepare: null,
    pair: null,
    chooseLegacy: null,
  });
});
it('hides the resolution-less combine while conflicts need picks', () => {
  useNativeSharedCartStore.setState({
    mergeConflicts: [{ productId }],
    status: 'choice_required',
    chooseLegacy: jest.fn().mockResolvedValue(undefined),
  });
  const screen = render(<SharedCartStatusPanel />);
  expect(screen.queryByRole('button', { name: 'Combine carts' })).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Combine with my choices' })
  ).toBeTruthy();
});
it('requires a per-item offer choice before combining legacy carts', () => {
  const chooseLegacy = jest.fn().mockResolvedValue(undefined);
  useNativeSharedCartStore.setState({
    mergeConflicts: [{ productId }],
    chooseLegacy,
  });
  const screen = render(<SharedCartStatusPanel />);
  const combine = screen.getByRole('button', {
    name: 'Combine with my choices',
  });
  expect(
    combine.props.accessibilityState?.disabled ?? combine.props.disabled
  ).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Keep device offer' }));
  fireEvent.press(
    screen.getByRole('button', { name: 'Combine with my choices' })
  );
  expect(chooseLegacy).toHaveBeenCalledWith('merge', [
    { item: { productId }, keep: 'incoming' },
  ]);
});

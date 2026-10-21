import { act, fireEvent, render } from '@testing-library/react-native';
import { useCartStore } from '@/stores/cart-store';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import { SharedCartStatusPanel } from './SharedCartStatusPanel';

const productId = '33333333-3333-4333-8333-333333333333';
beforeEach(() => {
  useCartStore.setState({ items: [] });
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
it('shows no dead choice buttons when no legacy chooser is available', () => {
  useNativeSharedCartStore.setState({
    status: 'choice_required',
    chooseLegacy: null,
  });
  const screen = render(<SharedCartStatusPanel />);
  expect(screen.queryByRole('button', { name: 'Combine carts' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Use saved cart' })).toBeNull();
  expect(
    screen.getByText(
      'You have a saved cart and items on this device. Choose which cart to use.'
    )
  ).toBeTruthy();
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
it('shows update guidance instead of offer choices for duplicate conflicts while keeping Use saved cart available', () => {
  const chooseLegacy = jest.fn().mockResolvedValue(undefined);
  useNativeSharedCartStore.setState({
    mergeConflicts: [{ productId }],
    mergeConflictReason: 'duplicate_identity',
    status: 'choice_required',
    chooseLegacy,
  });
  const screen = render(<SharedCartStatusPanel />);
  expect(
    screen.getByText(
      'Update duplicate voucher items in the original cart before combining.'
    )
  ).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: 'Combine with my choices' })
  ).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Keep device offer' })
  ).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Use saved cart' }));
  expect(chooseLegacy).toHaveBeenCalledWith('keep_server');
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
it('resets offer picks when a new conflict cycle starts on a changed cart', () => {
  const chooseLegacy = jest.fn().mockResolvedValue(undefined);
  useNativeSharedCartStore.setState({
    mergeConflicts: [{ productId }],
    snapshot: { cartId: 'cart-1', version: 1 } as never,
    status: 'choice_required',
    chooseLegacy,
  });
  const screen = render(<SharedCartStatusPanel />);
  fireEvent.press(screen.getByRole('button', { name: 'Keep device offer' }));
  const combine = () =>
    screen.getByRole('button', { name: 'Combine with my choices' });
  expect(
    combine().props.accessibilityState?.disabled ?? combine().props.disabled
  ).toBeFalsy();

  // A later cycle for the same item on a changed cart must not inherit
  // the earlier pick: Combine stays disabled until re-picked.
  act(() => {
    useNativeSharedCartStore.setState({
      snapshot: { cartId: 'cart-1', version: 2 } as never,
    });
  });
  expect(
    combine().props.accessibilityState?.disabled ?? combine().props.disabled
  ).toBeTruthy();
});

it('requires new picks after a conflict attempt changes status', () => {
  useNativeSharedCartStore.setState({
    status: 'choice_required',
    mergeConflicts: [{ productId }],
    chooseLegacy: jest.fn(),
  });
  const screen = render(<SharedCartStatusPanel />);
  fireEvent.press(screen.getByRole('button', { name: 'Keep device offer' }));
  act(() => useNativeSharedCartStore.setState({ status: 'pending' }));
  act(() => useNativeSharedCartStore.setState({ status: 'choice_required' }));
  const combine = screen.getByRole('button', {
    name: 'Combine with my choices',
  });
  expect(
    combine.props.accessibilityState?.disabled ?? combine.props.disabled
  ).toBeTruthy();
});
it('retries a failed initial cart creation using prepare rather than a read-only refresh', async () => {
  useCartStore.setState({
    items: [
      {
        id: 'local',
        product_id: productId,
        slug: 'phone',
        name: 'Phone',
        price: 100,
        quantity: 1,
      },
    ],
  });
  const prepare = jest.fn().mockResolvedValue(undefined);
  const refresh = jest.fn().mockResolvedValue(undefined);
  useNativeSharedCartStore.setState({
    status: 'error',
    prepare,
    refresh,
    snapshot: null,
  });
  const view = render(<SharedCartStatusPanel />);
  fireEvent.press(view.getByText('Retry sync'));
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(refresh).not.toHaveBeenCalled();
});

it('keeps retrying an empty device cart read-only', () => {
  const prepare = jest.fn().mockResolvedValue(undefined);
  const refresh = jest.fn().mockResolvedValue(undefined);
  useNativeSharedCartStore.setState({
    status: 'error',
    snapshot: null,
    prepare,
    refresh,
  });
  const view = render(<SharedCartStatusPanel />);
  fireEvent.press(view.getByText('Retry sync'));
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(prepare).not.toHaveBeenCalled();
});

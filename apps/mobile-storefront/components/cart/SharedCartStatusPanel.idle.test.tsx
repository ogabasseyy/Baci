import { render } from '@testing-library/react-native';
import { useCartStore } from '@/stores/cart-store';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import { SharedCartStatusPanel } from './SharedCartStatusPanel';

beforeEach(() => {
  useCartStore.setState({ items: [] });
  useNativeSharedCartStore.setState({
    enabled: true,
    status: 'ready',
    code: undefined,
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
it('stays hidden on a settled empty cart with nothing to sync', () => {
  useNativeSharedCartStore.setState({
    status: 'ready',
    snapshot: null,
    refresh: jest.fn().mockResolvedValue(undefined),
    prepare: jest.fn().mockResolvedValue(undefined),
  });
  const view = render(<SharedCartStatusPanel />);
  expect(view.toJSON()).toBeNull();
});
it('shows a plain syncing message while the cart is still loading', () => {
  useNativeSharedCartStore.setState({ status: 'loading', snapshot: null });
  const empty = render(<SharedCartStatusPanel />);
  expect(empty.getByText('Syncing your cart…')).toBeTruthy();
  expect(empty.queryByText(/refresh before checkout/)).toBeNull();
  empty.unmount();
  useCartStore.setState({ items: [{ id: 'line-1' } as never] });
  const withItems = render(<SharedCartStatusPanel />);
  expect(withItems.getByText('Syncing your cart…')).toBeTruthy();
  expect(
    withItems.queryByText(
      'Connect these items to your shared cart before checkout.'
    )
  ).toBeNull();
});
it('still offers to connect device items once loading has settled', () => {
  useCartStore.setState({ items: [{ id: 'line-1' } as never] });
  useNativeSharedCartStore.setState({
    status: 'ready',
    snapshot: null,
    refresh: jest.fn().mockResolvedValue(undefined),
    prepare: jest.fn().mockResolvedValue(undefined),
  });
  const view = render(<SharedCartStatusPanel />);
  expect(
    view.getByText('Connect these items to your shared cart before checkout.')
  ).toBeTruthy();
  expect(view.getByRole('button', { name: 'Connect cart' })).toBeTruthy();
});

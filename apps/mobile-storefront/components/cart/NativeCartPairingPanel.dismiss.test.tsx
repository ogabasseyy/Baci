import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  clearCartPairingLink,
  peekCartPairingLink,
} from '@/lib/cart/pairing-link';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import { sharedCartWriteRevision } from '@/stores/shared-cart-writer';
import { capturePairingLink } from './capture-pairing-link.test-support';
import { NativeCartPairingPanel } from './NativeCartPairingPanel';

jest.mock('@/components/ui/ModalSheet', () => {
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    ModalSheet: ({
      children,
      visible,
    }: {
      children: React.ReactNode;
      visible: boolean;
    }) => (visible ? <View>{children}</View> : null),
  };
});
jest.mock('@/lib/config', () => ({
  CONFIG: {
    MERCHANT_ID: '11111111-1111-4111-8111-111111111111',
    MERCHANT_SLUG: 'shop',
    MERCHANT_DOMAIN: 'shop.example.com',
  },
}));
jest.mock('@/env', () => ({ EXPO_PUBLIC_API_URL: 'https://usebaci.com' }));
jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn().mockResolvedValue({ type: 'cancel' }),
}));
let mockPairingItems: unknown[] = [];
jest.mock('@/stores/cart-store', () => ({
  useCartStore: (selector: (state: { items: unknown[] }) => unknown) =>
    selector({ items: mockPairingItems }),
}));
jest.mock('@/lib/cart/shared-cart-client', () => ({
  createNativeCartClient: () => ({
    previewHandoff: async (_handoffId: string, token: string) => {
      if (token.includes('crafted')) throw new Error('Invalid handoff');
      return {
        snapshot: { lines: [{ quantity: 2 }] },
        expiresAt: '2099-01-01T00:00:00Z',
      };
    },
  }),
}));
afterEach(() => {
  mockPairingItems = [];
  clearCartPairingLink();
});
it('clears pairing-owned conflicts when the shopper dismisses the sheet', async () => {
  useNativeSharedCartStore.setState({
    enabled: true,
    status: 'ready',
    pair: jest.fn().mockResolvedValue(undefined),
    mergeConflicts: [{ productId: '33333333-3333-4333-8333-333333333333' }],
    mergeConflictReason: 'price_mismatch',
  });
  capturePairingLink({ type: 'native', app: 'storefront' });
  const screen = render(<NativeCartPairingPanel />);
  const close = await waitFor(() =>
    screen.getByRole('button', { name: 'Close cart link' })
  );
  fireEvent.press(close);
  expect(useNativeSharedCartStore.getState().mergeConflicts).toEqual([]);
  expect(
    useNativeSharedCartStore.getState().mergeConflictReason
  ).toBeUndefined();
});
it('keeps legacy choice conflicts gated when dismissing a pairing sheet', async () => {
  useNativeSharedCartStore.setState({
    enabled: true,
    status: 'choice_required',
    pair: jest.fn().mockResolvedValue(undefined),
    mergeConflicts: [{ productId: '33333333-3333-4333-8333-333333333333' }],
  });
  capturePairingLink({ type: 'native', app: 'storefront' });
  const screen = render(<NativeCartPairingPanel />);
  const close = await waitFor(() =>
    screen.getByRole('button', { name: 'Close cart link' })
  );
  fireEvent.press(close);
  expect(useNativeSharedCartStore.getState().mergeConflicts).toHaveLength(1);
});
it('marks checkout intent when dismissing clears pairing conflicts', async () => {
  useNativeSharedCartStore.setState({
    enabled: true,
    status: 'ready',
    pair: jest.fn().mockResolvedValue(undefined),
    mergeConflicts: [{ productId: '33333333-3333-4333-8333-333333333333' }],
  });
  capturePairingLink({ type: 'native', app: 'storefront' });
  const screen = render(<NativeCartPairingPanel />);
  const close = await waitFor(() =>
    screen.getByRole('button', { name: 'Close cart link' })
  );
  const before = sharedCartWriteRevision();
  fireEvent.press(close);
  expect(useNativeSharedCartStore.getState().mergeConflicts).toEqual([]);
  expect(sharedCartWriteRevision()).toBe(before + 1);
});

it('retains the resolution sheet when close is pressed before pairing publishes late conflicts', async () => {
  mockPairingItems = [
    { product_id: '33333333-3333-4333-8333-333333333333', name: 'Phone' },
  ];
  let rejectPair!: () => void;
  const pair = jest.fn(
    () =>
      new Promise<void>((_, reject) => {
        rejectPair = () => {
          useNativeSharedCartStore.setState({
            status: 'error',
            mergeConflicts: [
              { productId: '33333333-3333-4333-8333-333333333333' },
            ],
            mergeConflictReason: 'price_mismatch',
          });
          reject(new Error('merge_conflict'));
        };
      })
  );
  useNativeSharedCartStore.setState({
    enabled: true,
    status: 'ready',
    pair,
    mergeConflicts: [],
    mergeConflictReason: undefined,
  });
  capturePairingLink({ type: 'native', app: 'storefront' });
  const view = render(<NativeCartPairingPanel />);
  const connect = await waitFor(() =>
    view.getByRole('button', { name: 'Combine carts' })
  );
  fireEvent.press(connect);
  // pair is awaiting preview/redeem, but has not set controller status=pending.
  expect(useNativeSharedCartStore.getState().status).toBe('ready');
  expect(view.getByLabelText('Syncing cart')).toBeTruthy();
  expect(
    view.getByRole('button', { name: 'Close cart link' }).props
      .accessibilityState.disabled
  ).toBe(true);
  fireEvent.press(view.getByRole('button', { name: 'Close cart link' }));
  expect(peekCartPairingLink()).not.toBeNull();
  await act(async () => {
    rejectPair();
  });
  await waitFor(() =>
    expect(
      view.getByText('Choose which offer to keep for each item.')
    ).toBeTruthy()
  );
  expect(peekCartPairingLink()).not.toBeNull();
  // Once pairing settles, the shopper can dismiss and clear pairing-owned conflicts.
  fireEvent.press(view.getByRole('button', { name: 'Close cart link' }));
  expect(peekCartPairingLink()).toBeNull();
  expect(useNativeSharedCartStore.getState().mergeConflicts).toEqual([]);
});

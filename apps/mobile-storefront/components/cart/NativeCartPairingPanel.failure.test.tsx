import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { clearCartPairingLink } from '@/lib/cart/pairing-link';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
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
it('lets the shopper retry a transient preview failure without closing the pairing link', async () => {
  let attempts = 0;
  const spy = jest
    .spyOn(
      jest.requireMock('@/lib/cart/shared-cart-client'),
      'createNativeCartClient'
    )
    .mockImplementation(() => ({
      previewHandoff: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('network error');
        return {
          snapshot: { lines: [{ quantity: 3 }] },
          expiresAt: '2099-01-01T00:00:00Z',
        };
      },
    }));
  try {
    capturePairingLink({ type: 'web' });
    const screen = render(<NativeCartPairingPanel />);
    const retry = await waitFor(() =>
      screen.getByRole('button', { name: 'Try again' })
    );
    fireEvent.press(retry);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Continue on website' })
      ).toBeTruthy()
    );
    expect(attempts).toBe(2);
  } finally {
    spy.mockRestore();
  }
});
it('clears the pairing failure state after a successful retry sync', async () => {
  mockPairingItems = [{ id: 'local-1' }];
  const pair = jest.fn().mockRejectedValue(new Error('create failed'));
  const refresh = jest.fn(async () => {
    useNativeSharedCartStore.setState({
      snapshot: { cartId: 'cart-1', version: 2 } as never,
    });
  });
  useNativeSharedCartStore.setState({
    enabled: true,
    status: 'ready',
    pair,
    refresh,
    prepare: null,
    snapshot: { cartId: 'cart-1', version: 1 } as never,
    mergeConflicts: [],
  });
  capturePairingLink({ type: 'native', app: 'storefront' });
  const screen = render(<NativeCartPairingPanel />);
  const keep = await waitFor(() =>
    screen.getByRole('button', { name: 'Keep my current cart' })
  );
  fireEvent.press(keep);
  const retry = await waitFor(() =>
    screen.getByRole('button', { name: 'Retry sync' })
  );
  fireEvent.press(retry);
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(
      screen.queryByText(
        'The cart has not finished syncing. Retry sync to check the saved attempt.'
      )
    ).toBeNull()
  );
});

it('keeps the pairing failure state when a retry resolves without a snapshot', async () => {
  mockPairingItems = [{ id: 'local-1' }];
  const pair = jest.fn().mockRejectedValue(new Error('create failed'));
  const refresh = jest.fn().mockResolvedValue(undefined);
  useNativeSharedCartStore.setState({
    enabled: true,
    status: 'ready',
    pair,
    refresh,
    prepare: null,
    snapshot: null,
    mergeConflicts: [],
  });
  capturePairingLink({ type: 'native', app: 'storefront' });
  const screen = render(<NativeCartPairingPanel />);
  const keep = await waitFor(() =>
    screen.getByRole('button', { name: 'Keep my current cart' })
  );
  fireEvent.press(keep);
  const retry = await waitFor(() =>
    screen.getByRole('button', { name: 'Retry sync' })
  );
  fireEvent.press(retry);
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  expect(
    screen.getByText(
      'The cart has not finished syncing. Retry sync to check the saved attempt.'
    )
  ).toBeTruthy();
});
it('keeps the pairing failure when retry leaves a pre-existing snapshot unchanged', async () => {
  mockPairingItems = [{ id: 'local-1' }];
  const pair = jest.fn().mockRejectedValue(new Error('redeem failed'));
  const refresh = jest.fn().mockResolvedValue(undefined);
  useNativeSharedCartStore.setState({
    enabled: true,
    status: 'ready',
    pair,
    refresh,
    prepare: null,
    snapshot: { cartId: 'cart-1', version: 1 } as never,
    mergeConflicts: [],
  });
  capturePairingLink({ type: 'native', app: 'storefront' });
  const screen = render(<NativeCartPairingPanel />);
  const keep = await waitFor(() =>
    screen.getByRole('button', { name: 'Keep my current cart' })
  );
  fireEvent.press(keep);
  const retry = await waitFor(() =>
    screen.getByRole('button', { name: 'Retry sync' })
  );
  fireEvent.press(retry);
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  expect(
    screen.getByText(
      'The cart has not finished syncing. Retry sync to check the saved attempt.'
    )
  ).toBeTruthy();
});

it('keeps the pairing failure when retry only creates a local cart', async () => {
  mockPairingItems = [{ id: 'local-1' }];
  const pair = jest.fn().mockRejectedValue(new Error('redeem failed'));
  const prepare = jest.fn(async () => {
    useNativeSharedCartStore.setState({
      snapshot: { cartId: 'cart-local', version: 1 } as never,
    });
  });
  useNativeSharedCartStore.setState({
    enabled: true,
    status: 'ready',
    pair,
    refresh: jest.fn().mockResolvedValue(undefined),
    prepare,
    snapshot: null,
    mergeConflicts: [],
  });
  capturePairingLink({ type: 'native', app: 'storefront' });
  const screen = render(<NativeCartPairingPanel />);
  const keep = await waitFor(() =>
    screen.getByRole('button', { name: 'Keep my current cart' })
  );
  fireEvent.press(keep);
  const retry = await waitFor(() =>
    screen.getByRole('button', { name: 'Retry sync' })
  );
  fireEvent.press(retry);
  await waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
  expect(
    screen.getByText(
      'The cart has not finished syncing. Retry sync to check the saved attempt.'
    )
  ).toBeTruthy();
});

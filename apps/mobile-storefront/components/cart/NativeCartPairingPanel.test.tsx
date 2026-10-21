import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import { clearCartPairingLink } from '@/lib/cart/pairing-link';
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
it('offers a trusted browser fallback for a web-bound grant, without attempting native redemption', async () => {
  const url = capturePairingLink({ type: 'web' });
  const screen = render(<NativeCartPairingPanel />);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Continue on website' })
    ).toBeTruthy()
  );
  expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Continue on website' }));
  await waitFor(() =>
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(url)
  );
});
it('does not offer the browser fallback when server preview rejects a crafted web hint', async () => {
  jest.mocked(WebBrowser.openBrowserAsync).mockClear();
  capturePairingLink({ type: 'web' }, 'crafted');
  const screen = render(<NativeCartPairingPanel />);
  await waitFor(() =>
    expect(
      screen.getByText(
        'This cart link could not be verified. Request a new link or try again later.'
      )
    ).toBeTruthy()
  );
  expect(
    screen.queryByRole('button', { name: 'Continue on website' })
  ).toBeNull();
  expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
});
it('marks a pairing choice as a checkout-fencing intent', async () => {
  const pair = jest.fn().mockResolvedValue(undefined);
  useNativeSharedCartStore.setState({
    enabled: true,
    status: 'ready',
    pair,
    mergeConflicts: [],
  });
  capturePairingLink({ type: 'native', app: 'storefront' });
  const screen = render(<NativeCartPairingPanel />);
  const connect = await waitFor(() =>
    screen.getByRole('button', { name: 'Connect cart' })
  );
  const before = sharedCartWriteRevision();
  fireEvent.press(connect);
  await waitFor(() => expect(pair).toHaveBeenCalledTimes(1));
  expect(sharedCartWriteRevision()).toBe(before + 1);
});
it('marks a web pairing continuation as a checkout-fencing intent', async () => {
  const url = capturePairingLink({ type: 'web' });
  const screen = render(<NativeCartPairingPanel />);
  const cont = await waitFor(() =>
    screen.getByRole('button', { name: 'Continue on website' })
  );
  const before = sharedCartWriteRevision();
  fireEvent.press(cont);
  await waitFor(() =>
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(url)
  );
  expect(sharedCartWriteRevision()).toBe(before + 1);
});

it('marks a pairing merge pick as a checkout-fencing intent', async () => {
  const pair = jest.fn().mockResolvedValue(undefined);
  useNativeSharedCartStore.setState({
    enabled: true,
    status: 'ready',
    pair,
    mergeConflicts: [{ productId: '33333333-3333-4333-8333-333333333333' }],
  });
  capturePairingLink({ type: 'native', app: 'storefront' });
  const screen = render(<NativeCartPairingPanel />);
  const pick = await waitFor(() =>
    screen.getByRole('radio', { name: 'Item: keep current offer' })
  );
  const before = sharedCartWriteRevision();
  fireEvent.press(pick);
  expect(sharedCartWriteRevision()).toBe(before + 1);
});

it('retries a failed pair with prepare when no canonical cart exists yet', async () => {
  mockPairingItems = [{ id: 'local-1' }];
  const pair = jest.fn().mockRejectedValue(new Error('create failed'));
  const refresh = jest.fn().mockResolvedValue(undefined);
  const prepare = jest.fn().mockResolvedValue(undefined);
  useNativeSharedCartStore.setState({
    enabled: true,
    status: 'ready',
    pair,
    refresh,
    prepare,
    snapshot: null,
    mergeConflicts: [],
  });
  capturePairingLink({ type: 'native', app: 'storefront' });
  const screen = render(<NativeCartPairingPanel />);
  const connect = await waitFor(() =>
    screen.getByRole('button', { name: 'Keep my current cart' })
  );
  fireEvent.press(connect);
  const retry = await waitFor(() =>
    screen.getByRole('button', { name: 'Retry sync' })
  );
  fireEvent.press(retry);
  await waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
  expect(refresh).not.toHaveBeenCalled();
});

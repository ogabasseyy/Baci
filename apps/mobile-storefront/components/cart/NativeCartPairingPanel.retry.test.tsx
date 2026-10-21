import { fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  captureCartPairingLink,
  clearCartPairingLink,
} from '@/lib/cart/pairing-link';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import { sharedCartWriteRevision } from '@/stores/shared-cart-writer';
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
it('marks a pairing retry sync as a checkout-fencing intent', async () => {
  const pair = jest.fn().mockRejectedValue(new Error('offline'));
  const refresh = jest.fn().mockResolvedValue(undefined);
  useNativeSharedCartStore.setState({
    enabled: true,
    status: 'ready',
    pair,
    refresh,
    mergeConflicts: [],
  });
  const merchant = '11111111-1111-4111-8111-111111111111';
  const token = `ch1.${Buffer.from(JSON.stringify({ merchantId: merchant, destination: { type: 'native', app: 'storefront' } })).toString('base64url')}.signature`;
  const url = `https://shop.example.com/cart#handoff=${token}&hid=22222222-2222-4222-8222-222222222222`;
  captureCartPairingLink(url, {
    merchantId: merchant,
    merchantSlug: 'shop',
    merchantDomain: 'shop.example.com',
  });
  const screen = render(<NativeCartPairingPanel />);
  const connect = await waitFor(() =>
    screen.getByRole('button', { name: 'Connect cart' })
  );
  fireEvent.press(connect);
  const retry = await waitFor(() =>
    screen.getByRole('button', { name: 'Retry sync' })
  );
  const before = sharedCartWriteRevision();
  fireEvent.press(retry);
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  expect(sharedCartWriteRevision()).toBe(before + 1);
});
it('offers pairing retry through prepare when refresh is not bound', async () => {
  mockPairingItems = [{ id: 'local-1' }];
  const pair = jest.fn().mockRejectedValue(new Error('create failed'));
  const prepare = jest.fn().mockResolvedValue(undefined);
  useNativeSharedCartStore.setState({
    enabled: true,
    status: 'ready',
    pair,
    refresh: null,
    prepare,
    snapshot: null,
    mergeConflicts: [],
  });
  const merchant = '11111111-1111-4111-8111-111111111111';
  const token = `ch1.${Buffer.from(JSON.stringify({ merchantId: merchant, destination: { type: 'native', app: 'storefront' } })).toString('base64url')}.signature`;
  const url = `https://shop.example.com/cart#handoff=${token}&hid=22222222-2222-4222-8222-222222222222`;
  captureCartPairingLink(url, {
    merchantId: merchant,
    merchantSlug: 'shop',
    merchantDomain: 'shop.example.com',
  });
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
});

it('offers no dead retry when refresh is unbound but a snapshot exists', async () => {
  mockPairingItems = [{ id: 'local-1' }];
  const pair = jest.fn().mockRejectedValue(new Error('sync failed'));
  const prepare = jest.fn().mockResolvedValue(undefined);
  useNativeSharedCartStore.setState({
    enabled: true,
    status: 'ready',
    pair,
    refresh: null,
    prepare,
    snapshot: { cartId: 'cart-1', version: 1 } as never,
    mergeConflicts: [],
  });
  const merchant = '11111111-1111-4111-8111-111111111111';
  const token = `ch1.${Buffer.from(JSON.stringify({ merchantId: merchant, destination: { type: 'native', app: 'storefront' } })).toString('base64url')}.signature`;
  const url = `https://shop.example.com/cart#handoff=${token}&hid=22222222-2222-4222-8222-222222222222`;
  captureCartPairingLink(url, {
    merchantId: merchant,
    merchantSlug: 'shop',
    merchantDomain: 'shop.example.com',
  });
  const screen = render(<NativeCartPairingPanel />);
  const keep = await waitFor(() =>
    screen.getByRole('button', { name: 'Keep my current cart' })
  );
  fireEvent.press(keep);
  await waitFor(() =>
    expect(
      screen.getByText(
        'The cart has not finished syncing. Retry sync to check the saved attempt.'
      )
    ).toBeTruthy()
  );
  expect(screen.queryByRole('button', { name: 'Retry sync' })).toBeNull();
  expect(prepare).not.toHaveBeenCalled();
});

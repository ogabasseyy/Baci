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
it('clears pairing-owned conflicts when the shopper dismisses the sheet', async () => {
  useNativeSharedCartStore.setState({
    enabled: true,
    status: 'ready',
    pair: jest.fn().mockResolvedValue(undefined),
    mergeConflicts: [{ productId: '33333333-3333-4333-8333-333333333333' }],
    mergeConflictReason: 'price_mismatch',
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
  const merchant = '11111111-1111-4111-8111-111111111111';
  const token = `ch1.${Buffer.from(JSON.stringify({ merchantId: merchant, destination: { type: 'native', app: 'storefront' } })).toString('base64url')}.signature`;
  const url = `https://shop.example.com/cart#handoff=${token}&hid=22222222-2222-4222-8222-222222222222`;
  captureCartPairingLink(url, {
    merchantId: merchant,
    merchantSlug: 'shop',
    merchantDomain: 'shop.example.com',
  });
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
  const merchant = '11111111-1111-4111-8111-111111111111';
  const token = `ch1.${Buffer.from(JSON.stringify({ merchantId: merchant, destination: { type: 'native', app: 'storefront' } })).toString('base64url')}.signature`;
  const url = `https://shop.example.com/cart#handoff=${token}&hid=22222222-2222-4222-8222-222222222222`;
  captureCartPairingLink(url, {
    merchantId: merchant,
    merchantSlug: 'shop',
    merchantDomain: 'shop.example.com',
  });
  const screen = render(<NativeCartPairingPanel />);
  const close = await waitFor(() =>
    screen.getByRole('button', { name: 'Close cart link' })
  );
  const before = sharedCartWriteRevision();
  fireEvent.press(close);
  expect(useNativeSharedCartStore.getState().mergeConflicts).toEqual([]);
  expect(sharedCartWriteRevision()).toBe(before + 1);
});

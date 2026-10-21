import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
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
it('offers a trusted browser fallback for a web-bound grant, without attempting native redemption', async () => {
  const merchant = '11111111-1111-4111-8111-111111111111';
  const token = `ch1.${Buffer.from(JSON.stringify({ merchantId: merchant, destination: { type: 'web' } })).toString('base64url')}.signature`;
  const url = `https://shop.example.com/cart#handoff=${token}&hid=22222222-2222-4222-8222-222222222222`;
  captureCartPairingLink(url, {
    merchantId: merchant,
    merchantSlug: 'shop',
    merchantDomain: 'shop.example.com',
  });
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
  const merchant = '11111111-1111-4111-8111-111111111111';
  const token = `ch1.${Buffer.from(JSON.stringify({ merchantId: merchant, destination: { type: 'web' } })).toString('base64url')}.crafted`;
  const url = `https://shop.example.com/cart#handoff=${token}&hid=22222222-2222-4222-8222-222222222222`;
  captureCartPairingLink(url, {
    merchantId: merchant,
    merchantSlug: 'shop',
    merchantDomain: 'shop.example.com',
  });
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
it('lets the shopper retry a transient preview failure without closing the pairing link', async () => {
  const merchant = '11111111-1111-4111-8111-111111111111';
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
    const token = `ch1.${Buffer.from(JSON.stringify({ merchantId: merchant, destination: { type: 'web' } })).toString('base64url')}.signature`;
    const url = `https://shop.example.com/cart#handoff=${token}&hid=22222222-2222-4222-8222-222222222222`;
    captureCartPairingLink(url, {
      merchantId: merchant,
      merchantSlug: 'shop',
      merchantDomain: 'shop.example.com',
    });
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
it('marks a pairing choice as a checkout-fencing intent', async () => {
  const pair = jest.fn().mockResolvedValue(undefined);
  useNativeSharedCartStore.setState({
    enabled: true,
    status: 'ready',
    pair,
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
  const before = sharedCartWriteRevision();
  fireEvent.press(connect);
  await waitFor(() => expect(pair).toHaveBeenCalledTimes(1));
  expect(sharedCartWriteRevision()).toBe(before + 1);
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
it('marks a web pairing continuation as a checkout-fencing intent', async () => {
  const merchant = '11111111-1111-4111-8111-111111111111';
  const token = `ch1.${Buffer.from(JSON.stringify({ merchantId: merchant, destination: { type: 'web' } })).toString('base64url')}.signature`;
  const url = `https://shop.example.com/cart#handoff=${token}&hid=22222222-2222-4222-8222-222222222222`;
  captureCartPairingLink(url, {
    merchantId: merchant,
    merchantSlug: 'shop',
    merchantDomain: 'shop.example.com',
  });
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
  const merchant = '11111111-1111-4111-8111-111111111111';
  const token = `ch1.${Buffer.from(JSON.stringify({ merchantId: merchant, destination: { type: 'native', app: 'storefront' } })).toString('base64url')}.signature`;
  const url = `https://shop.example.com/cart#handoff=${token}&hid=22222222-2222-4222-8222-222222222222`;
  captureCartPairingLink(url, {
    merchantId: merchant,
    merchantSlug: 'shop',
    merchantDomain: 'shop.example.com',
  });
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

import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import {
  captureCartPairingLink,
  clearCartPairingLink,
  peekCartPairingLink,
} from '@/lib/cart/pairing-link';
import type { CheckoutCartState } from '@/lib/cart/prepare-cart-checkout';
import { useCartCheckoutRecovery } from './use-cart-checkout-recovery';

let mockState: CheckoutCartState;
jest.mock('@/stores/native-shared-cart-store', () => ({
  useNativeSharedCartStore: { getState: () => mockState },
}));
jest.mock('expo-router', () => ({ useIsFocused: () => true }));
jest.mock('@/hooks/use-auth-guard', () => ({
  useAuthStatus: () => ({ user: null }),
}));
const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
beforeEach(() => {
  clearCartPairingLink();
  alert.mockClear();
});
afterEach(() => clearCartPairingLink());
it('withholds checkout when a same-route handoff arrives during preparation', async () => {
  let finish!: () => void;
  mockState = {
    enabled: true,
    status: 'ready',
    metadataReady: false,
    snapshot: null,
    refresh: jest.fn(),
    prepare: jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            mockState = {
              ...mockState,
              metadataReady: true,
              snapshot: { state: 'active', lines: [{}] },
            };
            resolve();
          };
        })
    ),
  };
  const next = jest.fn();
  const { result } = renderHook(() => useCartCheckoutRecovery(next));
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.recoverCheckout();
  });
  const merchantId = '11111111-1111-4111-8111-111111111111';
  const token = `ch1.${Buffer.from(JSON.stringify({ merchantId, destination: { type: 'native', app: 'storefront' } })).toString('base64url')}.signature`;
  act(() => {
    captureCartPairingLink(
      `https://shop.example.com/cart#handoff=${token}&hid=22222222-2222-4222-8222-222222222222`,
      { merchantId, merchantSlug: 'shop', merchantDomain: 'shop.example.com' }
    );
  });
  expect(peekCartPairingLink()).not.toBeNull();
  await act(async () => {
    finish();
    await pending;
  });
  expect(next).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith(
    'Choose your cart',
    expect.stringContaining('cart link')
  );
  expect(peekCartPairingLink()).not.toBeNull();
});

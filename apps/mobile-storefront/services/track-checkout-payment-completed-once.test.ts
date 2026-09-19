import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { trackCheckoutRoutePurchaseCompleted } from './tiktok-checkout-route-tracking';
import { trackCheckoutPaymentCompleted } from './track-checkout-payment-completed';
import { trackCheckoutPaymentCompletedOnce } from './track-checkout-payment-completed-once';

jest.mock('./track-checkout-payment-completed', () => ({
  trackCheckoutPaymentCompleted: jest.fn(),
}));
jest.mock('./tiktok-checkout-route-tracking', () => ({
  trackCheckoutRoutePurchaseCompleted: jest.fn(),
}));

const storage = new Map<string, string>();
const mockGetItem = jest.fn(async (key: string) => storage.get(key) ?? null);
const mockSetItem = jest.fn(async (key: string, value: string) => {
  storage.set(key, value);
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: (key: string) => mockGetItem(key),
    setItem: (key: string, value: string) => mockSetItem(key, value),
  },
}));
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  }),
}));
jest.mock('@/stores/cart-store', () => ({
  useCartStore: Object.assign(() => ({ clearCart: jest.fn() }), {
    getState: () => ({
      items: [{ id: 'item-1', name: 'Jar', price: 470000, quantity: 1 }],
    }),
  }),
}));

const completedMock = trackCheckoutPaymentCompleted as jest.Mock;
const purchaseMock = trackCheckoutRoutePurchaseCompleted as jest.Mock;

describe('trackCheckoutPaymentCompletedOnce', () => {
  beforeEach(() => {
    storage.clear();
    jest.clearAllMocks();
  });

  it('emits both the funnel event and the native purchase on first claim', async () => {
    await expect(
      trackCheckoutPaymentCompletedOnce({
        orderId: 'order-1',
        orderNumber: 'BAC-1',
        paymentMethod: 'bank_transfer',
        value: 470000,
      })
    ).resolves.toBe(true);

    expect(completedMock).toHaveBeenCalledTimes(1);
    expect(completedMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1' })
    );
    expect(purchaseMock).toHaveBeenCalledTimes(1);
    expect(purchaseMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1', total: 470000 })
    );
  });

  it('emits nothing when the same order replays after a remount', async () => {
    await trackCheckoutPaymentCompletedOnce({
      orderId: 'order-1',
      paymentMethod: 'bank_transfer',
      value: 470000,
    });

    await expect(
      trackCheckoutPaymentCompletedOnce({
        orderId: 'order-1',
        paymentMethod: 'bank_transfer',
        value: 470000,
      })
    ).resolves.toBe(false);

    expect(completedMock).toHaveBeenCalledTimes(1);
    expect(purchaseMock).toHaveBeenCalledTimes(1);
  });

  it('honours a claim persisted before the current session started', async () => {
    storage.set(
      'checkout-purchase-tracking-v1',
      JSON.stringify(['payment_completed:order-9'])
    );

    await expect(
      trackCheckoutPaymentCompletedOnce({
        orderId: 'order-9',
        paymentMethod: 'credpal',
      })
    ).resolves.toBe(false);

    expect(completedMock).not.toHaveBeenCalled();
    expect(purchaseMock).not.toHaveBeenCalled();
  });
});

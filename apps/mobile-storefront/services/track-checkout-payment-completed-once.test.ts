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
const mockCartItems: unknown[] = [];
jest.mock('@/stores/cart-store', () => ({
  useCartStore: Object.assign(() => ({ clearCart: jest.fn() }), {
    getState: () => ({ items: mockCartItems }),
  }),
}));

const completedMock = trackCheckoutPaymentCompleted as jest.Mock;
const purchaseMock = trackCheckoutRoutePurchaseCompleted as jest.Mock;

const DEFAULT_CART_ITEM = {
  id: 'item-1',
  name: 'Jar',
  price: 470000,
  product_id: 'prod-1',
  quantity: 1,
  slug: 'jar',
};

describe('trackCheckoutPaymentCompletedOnce', () => {
  beforeEach(() => {
    storage.clear();
    mockCartItems.length = 0;
    mockCartItems.push({ ...DEFAULT_CART_ITEM });
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

  it('keeps a synchronously snapshotted cart when clearing wins the race', async () => {
    const snapshot = [
      {
        id: 'item-9',
        name: 'Snapshot Jar',
        price: 1000,
        product_id: 'prod-9',
        quantity: 2,
        slug: 'snapshot-jar',
      },
    ];
    // The success route clears the cart while the durable claim is written.
    mockCartItems.length = 0;

    await expect(
      trackCheckoutPaymentCompletedOnce({
        items: snapshot,
        orderId: 'order-race',
        paymentMethod: 'bank_transfer',
        value: 2000,
      })
    ).resolves.toBe(true);

    expect(purchaseMock).toHaveBeenCalledWith(
      expect.objectContaining({ items: snapshot })
    );
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

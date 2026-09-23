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
const purchaseMock = trackCheckoutRoutePurchaseCompleted as jest.Mock<
  () => Promise<void>
>;

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
    ).resolves.toBe('emitted');

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
    ).resolves.toBe('already_emitted');

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
    ).resolves.toBe('emitted');

    expect(purchaseMock).toHaveBeenCalledWith(
      expect.objectContaining({ items: snapshot })
    );
  });

  it('carries guest identity and the canonical breakdown into the purchase', async () => {
    await expect(
      trackCheckoutPaymentCompletedOnce({
        customerEmail: 'guest@example.com',
        customerPhone: '+2348123456789',
        orderId: 'order-guest',
        orderNumber: 'BAC-GUEST',
        paymentMethod: 'wallet',
        shipping: 1500,
        subtotal: 45000,
        tax: 3375,
        value: 49875,
      })
    ).resolves.toBe('emitted');

    expect(purchaseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customerEmail: 'guest@example.com',
        customerPhone: '+2348123456789',
        orderId: 'order-guest',
        shipping: 1500,
        subtotal: 45000,
        tax: 3375,
        total: 49875,
      })
    );
  });

  it('rolls back the claim when the native purchase rejects so a later poll can emit', async () => {
    purchaseMock.mockRejectedValueOnce(new Error('Expo Crypto unavailable'));

    await expect(
      trackCheckoutPaymentCompletedOnce({
        orderId: 'order-retry',
        paymentMethod: 'bank_transfer',
        value: 470000,
      })
    ).resolves.toBe('released');

    // The funnel event must not leak ahead of the rolled-back attempt,
    // or its retry would double-count the conversion.
    expect(completedMock).not.toHaveBeenCalled();

    await expect(
      trackCheckoutPaymentCompletedOnce({
        orderId: 'order-retry',
        paymentMethod: 'bank_transfer',
        value: 470000,
      })
    ).resolves.toBe('emitted');

    expect(completedMock).toHaveBeenCalledTimes(1);
    expect(purchaseMock).toHaveBeenCalledTimes(2);
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
    ).resolves.toBe('already_emitted');

    expect(completedMock).not.toHaveBeenCalled();
    expect(purchaseMock).not.toHaveBeenCalled();
  });

  it('emits funnel-only when creation already sent the purchase', async () => {
    // The checkout finalization claims the default purchase key and
    // emits the ad purchase right after order creation; the completion
    // lane must not send it a second time for the same order. Seeded
    // as a versioned envelope so the v1 upgrade migration cannot
    // synthesize a completion claim from the bare purchase id.
    storage.set(
      'checkout-purchase-tracking-v1',
      JSON.stringify({ version: 2, claims: ['order-settled'] })
    );

    await expect(
      trackCheckoutPaymentCompletedOnce({
        orderId: 'order-settled',
        orderNumber: 'BAC-SETTLED',
        paymentMethod: 'paystack',
        value: 5750,
      })
    ).resolves.toBe('emitted');

    expect(completedMock).toHaveBeenCalledTimes(1);
    expect(completedMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-settled' })
    );
    expect(purchaseMock).not.toHaveBeenCalled();
  });

  it('never repeats the purchase across the create-to-settle sequence and its replay', async () => {
    const { claimCheckoutPurchaseTracking } = await import(
      '@/lib/claim-checkout-purchase-tracking'
    );
    // Creation-time claim, as runCheckoutFinalization performs it.
    await expect(claimCheckoutPurchaseTracking('order-seq')).resolves.toBe(
      true
    );

    await expect(
      trackCheckoutPaymentCompletedOnce({
        orderId: 'order-seq',
        paymentMethod: 'korapay',
        value: 9000,
      })
    ).resolves.toBe('emitted');

    expect(purchaseMock).not.toHaveBeenCalled();
    expect(completedMock).toHaveBeenCalledTimes(1);

    // A remount replay records nothing further.
    await expect(
      trackCheckoutPaymentCompletedOnce({
        orderId: 'order-seq',
        paymentMethod: 'korapay',
        value: 9000,
      })
    ).resolves.toBe('already_emitted');

    expect(purchaseMock).not.toHaveBeenCalled();
    expect(completedMock).toHaveBeenCalledTimes(1);
  });

  it('waits for the in-flight creation emission instead of trusting the bare claim', async () => {
    const {
      claimCheckoutPurchaseTracking,
      trackCreationPurchaseEmission,
    } = await import('@/lib/claim-checkout-purchase-tracking');
    let resolveCreation!: () => void;
    const creationEmission = new Promise<void>((resolve) => {
      resolveCreation = resolve;
    });
    // Creation-lane state: the bare claim is granted while the ad
    // purchase is still running.
    await expect(
      claimCheckoutPurchaseTracking('order-race-sent')
    ).resolves.toBe(true);
    trackCreationPurchaseEmission('order-race-sent', creationEmission);

    const outcome = trackCheckoutPaymentCompletedOnce({
      orderId: 'order-race-sent',
      orderNumber: 'BAC-RS',
      paymentMethod: 'paystack',
      value: 5750,
    });
    // Let the completion reach the shared emission: nothing may emit
    // while creation is still in flight.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(purchaseMock).not.toHaveBeenCalled();
    expect(completedMock).not.toHaveBeenCalled();

    resolveCreation();
    await expect(outcome).resolves.toBe('emitted');

    // Creation owned the purchase; the completion emitted funnel-only.
    expect(purchaseMock).not.toHaveBeenCalled();
    expect(completedMock).toHaveBeenCalledTimes(1);
    expect(completedMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-race-sent' })
    );
  });

  it('emits the purchase itself when the in-flight creation emission rejects', async () => {
    const {
      claimCheckoutPurchaseTracking,
      trackCreationPurchaseEmission,
    } = await import('@/lib/claim-checkout-purchase-tracking');
    const { releaseCheckoutPurchaseTracking } = await import(
      '@/lib/claim-checkout-purchase-release'
    );
    let rejectCreation!: (error: Error) => void;
    const creationEmission = new Promise<void>((_resolve, reject) => {
      rejectCreation = reject;
    });
    await expect(
      claimCheckoutPurchaseTracking('order-race-failed')
    ).resolves.toBe(true);
    trackCreationPurchaseEmission('order-race-failed', creationEmission);
    // Mirror the creation lane's rollback catch: a rejected emission
    // releases the bare claim.
    void creationEmission.catch(() =>
      releaseCheckoutPurchaseTracking('order-race-failed')
    );

    const outcome = trackCheckoutPaymentCompletedOnce({
      orderId: 'order-race-failed',
      orderNumber: 'BAC-RF',
      paymentMethod: 'korapay',
      value: 9000,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(purchaseMock).not.toHaveBeenCalled();
    expect(completedMock).not.toHaveBeenCalled();

    // Deferred rejection: the completion must not trust the
    // previously-held claim — it emits the purchase itself so the
    // conversion is not lost while the funnel event stands.
    rejectCreation(new Error('ad network down'));
    await expect(outcome).resolves.toBe('emitted');

    expect(purchaseMock).toHaveBeenCalledTimes(1);
    expect(purchaseMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-race-failed' })
    );
    expect(completedMock).toHaveBeenCalledTimes(1);
  });
});

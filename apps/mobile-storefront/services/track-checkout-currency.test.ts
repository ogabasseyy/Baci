import { CHECKOUT_FUNNEL_EVENTS } from '@baci/shared/contracts';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { trackEvent } from './analytics-core';
import { trackCheckoutRoutePurchaseCompleted } from './tiktok-checkout-route-tracking';
import { trackCheckoutOrderCreated } from './track-checkout-order-created';
import { trackCheckoutPaymentCompletedOnce } from './track-checkout-payment-completed-once';
import { trackCheckoutPaymentFailed } from './track-checkout-payment-failed';
import { trackCheckoutPaymentStarted } from './track-checkout-payment-started';
import { trackCheckoutStarted } from './track-checkout-started';

jest.mock('./analytics-core', () => ({
  trackEvent: jest.fn(),
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
    getState: () => ({ items: [] }),
  }),
}));

const mockedTrackEvent = trackEvent as jest.Mock;
const mockedRoutePurchase = trackCheckoutRoutePurchaseCompleted as jest.Mock<
  () => Promise<void>
>;

function funnelCurrencies(event: string): Array<string | undefined> {
  return mockedTrackEvent.mock.calls
    .filter(([name]) => name === event)
    .map(([, properties]) => (properties as { currency?: string }).currency);
}

/**
 * A complete non-NGN attempt must keep one currency on every funnel
 * stage: a later stage falling back to the NGN default would split the
 * attempt's revenue across two currencies in funnel analysis.
 */
describe('non-NGN checkout currency across funnel stages', () => {
  beforeEach(() => {
    storage.clear();
    jest.clearAllMocks();
  });

  it('carries the stamped currency from start through settlement', async () => {
    trackCheckoutStarted({ itemCount: 1, subtotal: 2000, currency: 'KES' });
    trackCheckoutOrderCreated({
      itemCount: 1,
      orderId: 'order-kes-settle',
      orderNumber: 'KES-1',
      paymentMethod: 'paystack',
      total: 2000,
      currency: 'KES',
    });
    await trackCheckoutPaymentStarted({
      orderId: 'order-kes-settle',
      orderNumber: 'KES-1',
      paymentMethod: 'paystack',
      reference: 'ref-kes-1',
      value: 2000,
      currency: 'KES',
    });
    await expect(
      trackCheckoutPaymentCompletedOnce({
        orderId: 'order-kes-settle',
        orderNumber: 'KES-1',
        paymentMethod: 'paystack',
        reference: 'ref-kes-1',
        value: 2000,
        currency: 'KES',
      })
    ).resolves.toBe('emitted');

    expect(funnelCurrencies(CHECKOUT_FUNNEL_EVENTS.checkoutStarted)).toEqual([
      'KES',
    ]);
    expect(funnelCurrencies(CHECKOUT_FUNNEL_EVENTS.orderCreated)).toEqual([
      'KES',
    ]);
    expect(funnelCurrencies(CHECKOUT_FUNNEL_EVENTS.paymentStarted)).toEqual([
      'KES',
    ]);
    expect(funnelCurrencies(CHECKOUT_FUNNEL_EVENTS.paymentCompleted)).toEqual([
      'KES',
    ]);
    expect(mockedRoutePurchase).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'KES' })
    );
  });

  it('carries the stamped currency onto the failure event', async () => {
    await trackCheckoutPaymentFailed(
      'declined',
      'order-kes-fail',
      'korapay',
      'ref-kes-2',
      'KES'
    );

    expect(funnelCurrencies(CHECKOUT_FUNNEL_EVENTS.paymentFailed)).toEqual([
      'KES',
    ]);
  });
});

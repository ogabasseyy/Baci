import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { trackPurchase } from '@/services/ad-tracking';
import { trackOrderCompleted } from '@/services/analytics';
import { trackCheckoutRoutePurchaseCompleted } from './tiktok-checkout-route-tracking';

jest.mock('@/services/ad-tracking', () => ({
  trackCheckoutStarted: jest.fn(),
  trackPaymentInfoAdded: jest.fn(),
  trackPurchase: jest.fn(),
}));

jest.mock('@/services/analytics', () => ({
  trackCheckoutStarted: jest.fn(),
  trackOrderCompleted: jest.fn(),
}));

const mockAdPurchase = jest.mocked(trackPurchase);
const mockOrderCompleted = jest.mocked(trackOrderCompleted);

const INPUT = {
  orderId: 'order-retry',
  orderNumber: 'BAC-RETRY',
  paymentMethod: 'bank_transfer',
  total: 470000,
};

describe('trackCheckoutRoutePurchaseCompleted', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAdPurchase.mockResolvedValue(undefined);
  });

  it('emits order_completed after the ad purchase succeeds', async () => {
    await trackCheckoutRoutePurchaseCompleted(INPUT);

    expect(mockAdPurchase).toHaveBeenCalledTimes(1);
    expect(mockOrderCompleted).toHaveBeenCalledTimes(1);
    expect(mockOrderCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-retry' })
    );
  });

  it('withholds order_completed when the ad purchase rejects so a retry does not double-count', async () => {
    mockAdPurchase.mockRejectedValueOnce(new Error('Expo Crypto unavailable'));

    await expect(trackCheckoutRoutePurchaseCompleted(INPUT)).rejects.toThrow(
      'Expo Crypto unavailable'
    );
    // The legacy funnel event must not escape ahead of the failed ad
    // emission: the shared completion claim rolls back and the retry
    // emits both events, so an early order_completed would double-count.
    expect(mockOrderCompleted).not.toHaveBeenCalled();

    await trackCheckoutRoutePurchaseCompleted(INPUT);

    expect(mockAdPurchase).toHaveBeenCalledTimes(2);
    expect(mockOrderCompleted).toHaveBeenCalledTimes(1);
  });
});

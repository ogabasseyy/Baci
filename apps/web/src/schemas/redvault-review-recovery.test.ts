import { expect, it } from 'vitest';
import { redvaultReviewRecoverySchema } from './redvault-review-recovery';

it('accepts a review and rejects missing proof or an invalid kobo amount', () => {
  const review = {
    ready: {
      orderId: 'order-1',
      trackingToken: 'proof',
      customerEmail: 'ada@example.test',
      customerName: 'Ada',
      customerPhone: '08012345678',
      checkoutFingerprint: 'uba_redvault:review',
      billingAddress: {
        line1: 'Pickup at Store',
        city: 'Lagos',
        country: 'NG',
      },
      currency: 'NGN',
      total: 100,
    },
    summary: {
      productSubtotalKobo: 10_000,
      eligibleSubtotalKobo: 10_000,
      ineligibleSubtotalKobo: 0,
      discountKobo: 0,
      assuranceFeeKobo: 0,
      taxKobo: 0,
      shippingKobo: 0,
      giftWrappingKobo: 0,
      payableKobo: 10_000,
      mixedBasket: false,
    },
  };
  expect(redvaultReviewRecoverySchema.safeParse(review).success).toBe(true);
  expect(
    redvaultReviewRecoverySchema.safeParse({
      ...review,
      ready: { ...review.ready, trackingToken: '' },
    }).success
  ).toBe(false);
  expect(
    redvaultReviewRecoverySchema.safeParse({
      ...review,
      summary: { ...review.summary, payableKobo: 0 },
    }).success
  ).toBe(false);
});

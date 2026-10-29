import { describe, expect, it } from 'vitest';
import { readRedvaultReviewRecovery } from './read-redvault-review-recovery';

const ready = {
  orderId: 'order-1', trackingToken: 'proof', customerEmail: 'ada@example.test',
  customerName: 'Ada Test', customerPhone: '08012345678', currency: 'NGN', total: 102.5,
  checkoutFingerprint: 'uba_redvault:{"merchantId":"merchant-1","customerEmail":"ada@example.test","items":[{"product_id":"one"}]}',
  billingAddress: { line1: 'Pickup at Store', city: 'Lagos', country: 'NG' },
};
const summary = {
  productSubtotalKobo: 10_000, eligibleSubtotalKobo: 10_000, ineligibleSubtotalKobo: 0,
  discountKobo: 500, assuranceFeeKobo: 0, taxKobo: 750, shippingKobo: 0,
  giftWrappingKobo: 0, payableKobo: 10_250, mixedBasket: false,
};
const pending = {
  paymentMethod: 'uba_redvault', orderId: ready.orderId, trackingToken: ready.trackingToken,
  merchantId: 'merchant-1', customerEmail: ready.customerEmail, customerPhone: ready.customerPhone,
  checkoutFingerprint: ready.checkoutFingerprint, amountDueToGateway: 102.5,
  createdAt: '2026-10-29T00:00:00.000Z', redvaultReview: { ready, summary },
};

describe('readRedvaultReviewRecovery', () => {
  it('accepts a consistent order and quote for the same merchant', () => {
    expect(readRedvaultReviewRecovery(pending, 'merchant-1')).toEqual({ ready, summary });
  });

  it.each([
    { ...pending, trackingToken: 'other-proof' },
    { ...pending, customerEmail: 'other@example.test' },
    { ...pending, amountDueToGateway: 100 },
    { ...pending, paymentMethod: 'paystack' },
    { ...pending, redvaultReview: { ready: { ...ready, currency: 'USD' }, summary } },
    { ...pending, redvaultReview: { ready, summary: { ...summary, payableKobo: -1 } } },
    { ...pending, checkoutFingerprint: 'uba_redvault:invalid', redvaultReview: { ready: { ...ready, checkoutFingerprint: 'uba_redvault:invalid' }, summary } },
  ])('rejects inconsistent or malformed stored state', (stored) => {
    expect(readRedvaultReviewRecovery(stored as never, 'merchant-1')).toBeNull();
  });
  it('does not restore the order in another merchant context', () => {
    expect(readRedvaultReviewRecovery(pending, 'other-merchant')).toBeNull();
  });
});

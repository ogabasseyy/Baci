import { describe, expect, it } from 'vitest';
import { isTerminalRedvaultReview } from './is-terminal-redvault-review';

const merchantId = 'merchant-1';
const fingerprint = `uba_redvault:${JSON.stringify({ merchantId, customerEmail: 'ada@example.test', items: [{ product_id: 'phone' }] })}`;
const ready = {
  cartId: 'original-cart',
  orderId: 'order-1',
  trackingToken: 'tracking-proof',
  customerEmail: 'ada@example.test',
  customerName: 'Ada Customer',
  customerPhone: '08000000000',
  checkoutFingerprint: fingerprint,
  billingAddress: {
    line1: 'Store pickup',
    city: 'Lagos',
    state: 'Lagos',
    country: 'NG',
  },
  currency: 'NGN',
  total: 102.5,
};
const pending = {
  merchantId,
  paymentMethod: 'uba_redvault',
  orderId: ready.orderId,
  trackingToken: ready.trackingToken,
  customerEmail: ready.customerEmail,
  customerPhone: ready.customerPhone,
  checkoutFingerprint: fingerprint,
  amountDueToGateway: 102.5,
  redvaultReview: {
    ready,
    summary: {
      productSubtotalKobo: 10_000,
      eligibleSubtotalKobo: 10_000,
      ineligibleSubtotalKobo: 0,
      discountKobo: 500,
      assuranceFeeKobo: 0,
      taxKobo: 750,
      shippingKobo: 0,
      giftWrappingKobo: 0,
      payableKobo: 10_250,
      mixedBasket: false,
    },
  },
};
const input: Parameters<typeof isTerminalRedvaultReview>[0] = {
  merchantId,
  pendingOrder: pending as never,
  sharedCartEnabled: true,
  sharedCartRef: { cartId: 'replacement-cart', version: 1 },
  checkoutItemCount: 0,
};

describe('terminal UBA review', () => {
  it('can resume a verified cart-bound review with an empty replacement cart', () => {
    expect(isTerminalRedvaultReview(input)).toBe(true);
  });

  it('does not resume a legacy unbound review over a replacement cart', () => {
    const { cartId: _cartId, ...legacyReady } = ready;
    expect(
      isTerminalRedvaultReview({
        ...input,
        pendingOrder: {
          ...pending,
          redvaultReview: { ...pending.redvaultReview, ready: legacyReady },
        } as never,
      })
    ).toBe(false);
  });

  it('rejects an active cart, a different merchant, and a mismatched review', () => {
    expect(isTerminalRedvaultReview({ ...input, checkoutItemCount: 1 })).toBe(
      false
    );
    expect(isTerminalRedvaultReview({ ...input, merchantId: 'other' })).toBe(
      false
    );
    expect(
      isTerminalRedvaultReview({
        ...input,
        pendingOrder: { ...pending, trackingToken: 'different' } as never,
      })
    ).toBe(false);
    expect(
      isTerminalRedvaultReview({ ...input, sharedCartEnabled: false })
    ).toBe(false);
  });
});

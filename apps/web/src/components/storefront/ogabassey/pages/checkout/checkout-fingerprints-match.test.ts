import { expect, it } from 'vitest';
import { checkoutFingerprintsMatch } from './checkout-fingerprints-match';

it('recovers a pending order saved before quote UUIDs were removed from fingerprints', () => {
  expect(
    checkoutFingerprintsMatch(
      JSON.stringify({
        merchantId: 'merchant',
        selectedQuoteId: 'old',
        shippingFee: 3518,
      }),
      JSON.stringify({ merchantId: 'merchant', shippingFee: 3518 })
    )
  ).toBe(true);
});
it('retains changed prices and tenant identities as different checkouts', () => {
  expect(
    checkoutFingerprintsMatch(
      '{"merchantId":"a","selectedQuoteId":"old"}',
      '{"merchantId":"b"}'
    )
  ).toBe(false);
  expect(
    checkoutFingerprintsMatch(
      '{"shippingFee":3518,"selectedQuoteId":"old"}',
      '{"shippingFee":2201}'
    )
  ).toBe(false);
});
it('does not turn malformed fingerprints into equal checkouts', () => {
  expect(checkoutFingerprintsMatch('old', 'new')).toBe(false);
});

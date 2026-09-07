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

it('matches legacy carrier attempts without a merchant rate against explicit null', () => {
  const legacy = JSON.stringify({ shippingFee: 3518, selectedQuoteId: 'old', items: [] });
  const current = JSON.stringify({ shippingFee: 3518, merchantRateId: null, items: [] });
  expect(checkoutFingerprintsMatch(legacy, current)).toBe(true);
  expect(checkoutFingerprintsMatch(current, legacy)).toBe(true);
});
it('preserves non-null merchant rate identities', () => {
  expect(checkoutFingerprintsMatch('{"shippingFee":100}', '{"shippingFee":100,"merchantRateId":"rate-a"}')).toBe(false);
  expect(checkoutFingerprintsMatch('{"merchantRateId":"rate-a"}', '{"merchantRateId":"rate-b"}')).toBe(false);
});

it('matches missing legacy variant fields to empty non-variant attributes', () => {
  const legacy = JSON.stringify({items: [{product_id: 'p', price: 100}]});
  const current = JSON.stringify({items: [{product_id: 'p', price: 100, variantAttributes: {}}]});
  expect(checkoutFingerprintsMatch(legacy, current)).toBe(true);
  expect(checkoutFingerprintsMatch(legacy, JSON.stringify({items: [{product_id: 'p', price: 100, variantId: 'new'}]}))).toBe(false);
  expect(checkoutFingerprintsMatch(legacy, JSON.stringify({items: [{product_id: 'p', price: 100, variantAttributes: {color: 'blue'}}]}))).toBe(false);
});

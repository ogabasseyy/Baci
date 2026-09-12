import { describe, expect, it } from 'vitest';
import { parseRedvaultOrderQuote } from './parse-redvault-order-quote';

const quote = {
  product_subtotal_kobo: 11000,
  eligible_subtotal_kobo: 10000,
  ineligible_subtotal_kobo: 1000,
  discount_kobo: 500,
  tax_kobo: 750,
  shipping_kobo: 500,
  gift_wrapping_kobo: 0,
  payable_kobo: 11750,
  mixed_basket: true,
};
describe('frozen REDVAULT quote', () => {
  it('uses all server fields verbatim including zero gift wrapping', () => {
    expect(parseRedvaultOrderQuote({ redvault: { quote } })).toEqual({
      productSubtotalKobo: 11000,
      eligibleSubtotalKobo: 10000,
      ineligibleSubtotalKobo: 1000,
      discountKobo: 500,
      taxKobo: 750,
      shippingKobo: 500,
      giftWrappingKobo: 0,
      payableKobo: 11750,
      mixedBasket: true,
    });
  });
  it.each(
    Object.keys(quote)
  )('rejects missing %s without a client fallback', (key) => {
    const incomplete = { ...quote };
    Reflect.deleteProperty(incomplete, key);
    expect(() =>
      parseRedvaultOrderQuote({ total: 999, redvault: { quote: incomplete } })
    ).toThrow();
  });
  it.each([
    -1,
    0.5,
    Number.MAX_SAFE_INTEGER + 1,
    '100',
  ])('rejects invalid money %s', (value) => {
    expect(() =>
      parseRedvaultOrderQuote({
        redvault: { quote: { ...quote, payable_kobo: value } },
      })
    ).toThrow();
  });

  it.each([
    { discount_kobo: 10001 },
    { ineligible_subtotal_kobo: 999 },
    { mixed_basket: false },
    { payable_kobo: 11749 },
  ])('rejects an inconsistent frozen quote: %o', (invalidQuote) => {
    expect(() =>
      parseRedvaultOrderQuote({
        redvault: { quote: { ...quote, ...invalidQuote } },
      })
    ).toThrow('Inconsistent REDVAULT summary');
  });
});

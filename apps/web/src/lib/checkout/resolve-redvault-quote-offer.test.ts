import { describe, expect, it } from 'vitest';
import { CanonicalOrderSubtotalLoadError } from './canonical-order-subtotal';
import { resolveRedvaultQuoteOffer } from './resolve-redvault-quote-offer';

describe('resolveRedvaultQuoteOffer', () => {
  it('returns undefined economics for a non-offer line', () => {
    expect(
      resolveRedvaultQuoteOffer(
        { product_id: 'product-1', variant_id: null },
        {}
      )
    ).toEqual({ offerCondition: undefined, offerPrice: undefined });
  });

  it('ignores the offer when a variant shares the line', () => {
    expect(
      resolveRedvaultQuoteOffer(
        { offer_id: 'offer-1', product_id: 'product-1', variant_id: 'v-1' },
        {
          offerConditions: new Map([['product-1::offer-1', 'used']]),
          offerPrices: new Map([['product-1::offer-1', 80000]]),
        }
      )
    ).toEqual({ offerCondition: undefined, offerPrice: undefined });
  });

  it('resolves verified live offer economics by product and offer', () => {
    expect(
      resolveRedvaultQuoteOffer(
        { offer_id: 'offer-1', product_id: 'product-1' },
        {
          offerConditions: new Map([['product-1::offer-1', 'used']]),
          offerPrices: new Map([['product-1::offer-1', 80000]]),
        }
      )
    ).toEqual({ offerCondition: 'used', offerPrice: 80000 });
  });

  it('fails closed when the offer line lacks verified economics', () => {
    expect(() =>
      resolveRedvaultQuoteOffer(
        { offer_id: 'offer-1', product_id: 'product-1' },
        { offerPrices: new Map([['product-1::offer-1', 80000]]) }
      )
    ).toThrowError(CanonicalOrderSubtotalLoadError);
    expect(() =>
      resolveRedvaultQuoteOffer(
        { offer_id: 'offer-1', product_id: 'product-1' },
        {}
      )
    ).toThrowError(CanonicalOrderSubtotalLoadError);
  });
});

import { describe, expect, it } from 'vitest';
import { resolveAgenticTaxLinePrice } from './resolve-agentic-tax-line-price';

describe('resolveAgenticTaxLinePrice', () => {
  it('prefers the variant override over the live offer and parent prices', () => {
    expect(
      resolveAgenticTaxLinePrice({
        candidateVariant: { product_id: 'prod-1', price_override: 5000 },
        item: {
          product_id: 'prod-1',
          variant_id: 'var-1',
          offer_id: 'offer-1',
        },
        offerPrices: new Map([['prod-1::offer-1', 4000]]),
        product: { price: 10000 },
      })
    ).toBe(5000);
  });

  it('falls back to the live offer price for offer lines', () => {
    expect(
      resolveAgenticTaxLinePrice({
        candidateVariant: null,
        item: { product_id: 'prod-1', offer_id: 'offer-1' },
        offerPrices: new Map([['prod-1::offer-1', 4000]]),
        product: { price: 10000 },
      })
    ).toBe(4000);
  });

  it('ignores cross-product variant and offer matches', () => {
    expect(
      resolveAgenticTaxLinePrice({
        candidateVariant: { product_id: 'prod-2', price_override: 5000 },
        item: {
          product_id: 'prod-1',
          variant_id: 'var-2',
          offer_id: 'offer-1',
        },
        offerPrices: new Map([['prod-2::offer-1', 4000]]),
        product: { price: 10000 },
      })
    ).toBe(10000);
  });

  it('returns null for non-positive or non-finite prices', () => {
    expect(
      resolveAgenticTaxLinePrice({
        candidateVariant: null,
        item: { product_id: 'prod-1' },
        product: { price: 0 },
      })
    ).toBeNull();
    expect(
      resolveAgenticTaxLinePrice({
        candidateVariant: null,
        item: { product_id: 'prod-1' },
        product: { price: null },
      })
    ).toBeNull();
  });
});

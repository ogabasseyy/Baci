import { describe, expect, it } from 'vitest';
import { isDurableSeoDenomination } from './classify-durable-product-seo-denomination';
import { getProductSeoMoneyCandidates } from './get-product-seo-money-candidates';

describe('isDurableSeoDenomination', () => {
  const productName = 'PlayStation Store Gift Card £50';
  const denominations = getProductSeoMoneyCandidates(productName).filter(
    (c) => c.marker
  );

  it('recognizes valid denomination amounts matching gift card identity', () => {
    const text = 'Official card delivering £50 credit on PlayStation Network.';
    const candidate = getProductSeoMoneyCandidates(text)[0];
    expect(candidate).toBeDefined();
    if (!candidate) throw new Error('Expected candidate');
    expect(
      isDurableSeoDenomination(candidate, text, productName, denominations)
    ).toBe(true);
  });

  it('rejects candidates when amount differs from product denomination', () => {
    const text = 'Delivers £100 credit on PlayStation Network.';
    const candidate = getProductSeoMoneyCandidates(text)[0];
    expect(candidate).toBeDefined();
    if (!candidate) throw new Error('Expected candidate');
    expect(
      isDurableSeoDenomination(candidate, text, productName, denominations)
    ).toBe(false);
  });

  it('rejects candidate when accompanied by a retail purchase cue', () => {
    const text = 'On sale for £50 credit today.';
    const candidate = getProductSeoMoneyCandidates(text)[0];
    expect(candidate).toBeDefined();
    if (!candidate) throw new Error('Expected candidate');
    expect(
      isDurableSeoDenomination(candidate, text, productName, denominations)
    ).toBe(false);
  });
});

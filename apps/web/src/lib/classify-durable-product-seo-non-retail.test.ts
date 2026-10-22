import { describe, expect, it } from 'vitest';
import { isClearlyNonRetailSeoAmount } from './classify-durable-product-seo-non-retail';
import { getProductSeoMoneyCandidates } from './get-product-seo-money-candidates';

describe('isClearlyNonRetailSeoAmount', () => {
  it.each([
    'Get $50 cashback on activation.',
    'Includes $20 trade-in credit toward accessories.',
    'Features $100 store credit with yearly plan.',
    'Eligible for $30 rebate after mail-in form.',
  ])('identifies trailing non-retail benefit amounts: %s', (text) => {
    const candidate = getProductSeoMoneyCandidates(text)[0];
    expect(candidate).toBeDefined();
    if (!candidate) throw new Error('Expected candidate');
    expect(isClearlyNonRetailSeoAmount(candidate, text)).toBe(true);
  });

  it.each([
    'Includes cashback of $50 on selected plans.',
    'Buy a phone and get cashback of $50',
    'Includes cashback of up to $50 on selected plans.',
    'Comes with a rebate of $25 for students.',
    'Eligible for bonus of $15 on initial top-up.',
    'Includes store credit of $40 with trade-in.',
  ])('identifies preceding non-retail benefit amounts: %s', (text) => {
    const candidate = getProductSeoMoneyCandidates(text)[0];
    expect(candidate).toBeDefined();
    if (!candidate) throw new Error('Expected candidate');
    expect(isClearlyNonRetailSeoAmount(candidate, text)).toBe(true);
  });

  it('rejects non-retail classification when retail price cues dominate', () => {
    const text = 'Price: $50 cashback included.';
    const candidate = getProductSeoMoneyCandidates(text)[0];
    expect(candidate).toBeDefined();
    if (!candidate) throw new Error('Expected candidate');
    expect(isClearlyNonRetailSeoAmount(candidate, text)).toBe(false);
  });
});

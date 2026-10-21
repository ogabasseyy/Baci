import { describe, expect, it } from 'vitest';
import { isDurableSeoPrice } from './classify-durable-product-seo-price';
import { getProductSeoMoneyCandidates } from './get-product-seo-money-candidates';

describe('isDurableSeoPrice', () => {
  it.each([
    'The voltage is 12.5 volts.',
    'The brightness is 1,200 lumens.',
    'The bottle holds 1.5 liters.',
    'The temperature is 23.5 degrees.',
  ])('does not classify physical measurements as prices: %s', (text) => {
    const candidate = getProductSeoMoneyCandidates(text)[0];
    expect(candidate).toBeDefined();
    if (!candidate) throw new Error('Expected a monetary-looking candidate');
    expect(isDurableSeoPrice(candidate, text)).toBe(false);
  });

  it.each([
    'Maximum load capacity is 900 pounds.',
    'Payload capacity is 1,200 pounds.',
  ])('preserves pound-denominated capacity: %s', (text) => {
    const candidate = getProductSeoMoneyCandidates(text)[0];
    expect(candidate).toBeDefined();
    if (!candidate) throw new Error('Expected a monetary-looking candidate');
    expect(isDurableSeoPrice(candidate, text)).toBe(false);
  });

  it('still classifies an explicit pound-denominated sale as a price', () => {
    const text = 'Weighs 5 pounds and sells for 900 pounds.';
    const candidate = getProductSeoMoneyCandidates(text).at(-1);
    expect(candidate).toBeDefined();
    if (!candidate) throw new Error('Expected a monetary-looking candidate');
    expect(isDurableSeoPrice(candidate, text)).toBe(true);
  });
});

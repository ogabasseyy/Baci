import { describe, expect, it } from 'vitest';
import { isProductVariantRegionToken } from './is-product-variant-region-token';

describe('isProductVariantRegionToken', () => {
  it('recognizes unambiguous catalog regions without treating model tiers as regions', () => {
    expect(isProductVariantRegionToken('uk')).toBe(true);
    expect(isProductVariantRegionToken('pro')).toBe(false);
  });

  it('requires catalog context for ambiguous India and US region codes', () => {
    expect(isProductVariantRegionToken('in')).toBe(false);
    expect(isProductVariantRegionToken('in', { isTerminal: true })).toBe(true);
    expect(isProductVariantRegionToken('us')).toBe(false);
    expect(isProductVariantRegionToken('us', { isTerminal: true })).toBe(true);
    expect(isProductVariantRegionToken('us', { nextToken: 'version' })).toBe(
      true
    );
  });
});

import { describe, expect, it } from 'vitest';
import { getVariantSchemaVariesBy } from './product-schema-varies-by';
import type { ProductVariant } from './products';

describe('getVariantSchemaVariesBy', () => {
  it('omits dimensions missing from a variant', () => {
    const variants = [
      { attributes: { color: 'Silver', storage: '512GB' } },
      { attributes: {} },
    ] as ProductVariant[];
    expect(getVariantSchemaVariesBy(variants)).toEqual([]);
  });
  it('deduplicates supported dimensions present on every variant', () => {
    const variants = [
      { attributes: { colour: 'Silver', storage: '512GB', ram: '16GB' } },
      { attributes: { color: 'Black', size: '256GB' } },
    ] as ProductVariant[];
    expect(getVariantSchemaVariesBy(variants)).toEqual([
      'https://schema.org/color',
      'https://schema.org/size',
    ]);
  });
});

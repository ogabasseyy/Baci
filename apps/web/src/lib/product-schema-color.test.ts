import { describe, expect, it } from 'vitest';
import { getVariantSchemaColor } from './product-schema-color';
import { getVariantSchemaSize } from './product-schema-size';

describe('color', () => {
  it('normalizes known color and size aliases without inventing absent values', () => {
    expect(getVariantSchemaColor({ Colour: ' Silver ' })).toBe('Silver');
    expect(
      getVariantSchemaColor({ color: 'Space Black '.repeat(15) })
    ).toBeUndefined();
    expect(getVariantSchemaColor({ ram: '16GB' })).toBeUndefined();
    expect(getVariantSchemaSize({ storage: '512GB', ram: '16GB' })).toBe(
      '512GB / 16GB'
    );
    expect(
      getVariantSchemaSize({
        storage: 'specification '.repeat(20),
        ram: '32GB',
      })
    ).toBe('32GB');
  });
});

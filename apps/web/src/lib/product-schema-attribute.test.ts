import { describe, expect, it } from 'vitest';
import { getNormalizedVariantAttribute } from './product-schema-attribute';

describe('getNormalizedVariantAttribute', () => {
  it('normalizes case and whitespace while omitting empty attributes', () => {
    expect(
      getNormalizedVariantAttribute({ Colour: ' Silver ' }, ['color', 'colour'])
    ).toBe('Silver');
    expect(
      getNormalizedVariantAttribute({ color: ' ' }, ['color'])
    ).toBeUndefined();
    expect(getNormalizedVariantAttribute(null, ['color'])).toBeUndefined();
  });
});

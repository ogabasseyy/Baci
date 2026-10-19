import { describe, expect, it } from 'vitest';
import { getMcpVariantColorValue } from './variant-color-value';

describe('getMcpVariantColorValue', () => {
  it.each([
    { attributes: { color: 'Red' }, expected: 'Red' },
    { attributes: { Colour: 'Blue' }, expected: 'Blue' },
    { attributes: { colour: 'Green' }, expected: 'Green' },
  ])('reads the supported $attributes color axis', ({ attributes, expected }) => {
    expect(getMcpVariantColorValue(attributes)).toBe(expected);
  });

  it('uses canonical color precedence and preserves the stored value', () => {
    expect(getMcpVariantColorValue({ color: ' Red ', Colour: 'Blue', colour: 'Green' })).toBe(' Red ');
  });

  it('does not accept unsupported keys, images, or blank values as color evidence', () => {
    expect(getMcpVariantColorValue({ Color: 'Black' })).toBeUndefined();
    expect(getMcpVariantColorValue({ color: '  ', Colour: '' })).toBeUndefined();
    expect(getMcpVariantColorValue(undefined)).toBeUndefined();
  });
});

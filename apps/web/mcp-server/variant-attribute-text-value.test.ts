import { describe, expect, it } from 'vitest';
import { getMcpVariantAttributeTextValue } from './variant-attribute-text-value';

describe('getMcpVariantAttributeTextValue', () => {
  it.each([undefined, null, '', Number.NaN, {}, { storage: 128 }, [], ['Red']])('omits empty or non-primitive value %#', (value) => {
    expect(getMcpVariantAttributeTextValue(value)).toBeUndefined();
  });
  it.each([
    { value: 0, text: '0' }, { value: false, text: 'false' },
    { value: true, text: 'true' }, { value: 128, text: '128' },
    { value: 'Red', text: 'Red' }, { value: ' ', text: ' ' },
  ])('preserves primitive $text', ({ value, text }) => {
    expect(getMcpVariantAttributeTextValue(value)).toBe(text);
  });
});

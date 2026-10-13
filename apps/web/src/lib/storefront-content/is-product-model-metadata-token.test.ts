import { describe, expect, it } from 'vitest';
import { isProductModelMetadataToken } from './is-product-model-metadata-token';

describe('isProductModelMetadataToken', () => {
  it.each([
    '4k',
    '8k',
    'fhd',
    'qhd',
    'uhd',
  ])('treats %s as monitor resolution metadata', (token) => {
    expect(isProductModelMetadataToken(token, 'monitors')).toBe(true);
  });

  it('does not remove a resolution-like token from unrelated product identity', () => {
    expect(isProductModelMetadataToken('4k', 'gaming')).toBe(false);
  });

  it('preserves printer model specifications under the existing contract', () => {
    expect(isProductModelMetadataToken('4k', 'printers')).toBe(false);
  });

  it.each([
    'oled',
    'gaming',
  ])('treats trailing monitor descriptor %s as metadata', (token) => {
    expect(isProductModelMetadataToken(token, 'monitors')).toBe(true);
  });
});

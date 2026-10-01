import { describe, expect, it } from 'vitest';
import { normalizeProductModelTokens } from './normalize-product-model-tokens';

describe('normalizeProductModelTokens catalog finishes', () => {
  it('strips titanium and obsidian finishes from model identity', () => {
    expect(
      normalizeProductModelTokens([
        'iphone',
        '15',
        'pro',
        'max',
        'natural',
        'titanium',
      ])
    ).toEqual(['iphone', '15', 'pro', 'max']);
    expect(
      normalizeProductModelTokens(['pixel', '9', 'pro', 'obsidian'])
    ).toEqual(['pixel', '9', 'pro']);
  });

  it('strips Pixel Porcelain and Bay finishes from model identity', () => {
    expect(
      normalizeProductModelTokens(['pixel', '8', 'pro', 'porcelain'])
    ).toEqual(['pixel', '8', 'pro']);
    expect(normalizeProductModelTokens(['pixel', '8', 'pro', 'bay'])).toEqual([
      'pixel',
      '8',
      'pro',
    ]);
  });
});

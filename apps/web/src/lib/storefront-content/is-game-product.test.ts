import { describe, expect, it } from 'vitest';
import { isGameProduct } from './is-game-product';

const tokenize = (value: string) => value.toLowerCase().split(/[^a-z0-9]+/u);

describe('isGameProduct', () => {
  it('preserves game-title tokens for software products', () => {
    expect(
      isGameProduct(
        {
          categorySlug: 'playstation-5',
          productNames: ['PS5 EA Sports FC 25'],
        },
        tokenize
      )
    ).toBe(true);
  });

  it('does not preserve merchandising tokens for gaming hardware', () => {
    expect(
      isGameProduct(
        {
          categorySlug: 'playstation-5',
          productNames: ['Sony DualSense Wireless Controller White'],
        },
        tokenize
      )
    ).toBe(false);
  });

  it('classifies a Nintendo Switch OLED console without a console noun as hardware', () => {
    expect(
      isGameProduct(
        {
          categorySlug: 'nintendo-switch',
          productNames: ['Nintendo Switch OLED Model White'],
        },
        tokenize
      )
    ).toBe(false);
  });
});

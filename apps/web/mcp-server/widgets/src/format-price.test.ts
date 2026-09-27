import { describe, expect, it } from 'vitest';
import { formatPrice } from './format-price';

describe('formatPrice', () => {
  it('formats whole naira amounts for catalog and cart totals', () => {
    expect(formatPrice(128279)).toMatch(/₦\s?128,279/);
    expect(formatPrice(0)).toMatch(/₦\s?0/);
  });
});

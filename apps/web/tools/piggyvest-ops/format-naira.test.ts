import { describe, expect, it } from 'vitest';
import { formatNaira } from './format-naira';

describe('formatNaira', () => {
  it.each([
    [0, '₦0.00'],
    [5, '₦0.05'],
    [1_500_000, '₦15,000.00'],
    [123_456_789, '₦1,234,567.89'],
  ])('formats %i kobo as %s', (kobo, text) => {
    expect(formatNaira(kobo)).toBe(text);
  });
});

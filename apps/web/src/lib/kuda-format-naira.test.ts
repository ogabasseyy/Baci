import { describe, expect, it } from 'vitest';
import { formatNaira } from './kuda-format-naira';

describe('formatNaira', () => {
  it('shows whole amounts without decimals', () => {
    expect(formatNaira(1000)).toBe('₦1,000');
  });

  it('shows two decimals for fractional amounts', () => {
    expect(formatNaira(1000.5)).toBe('₦1,000.50');
  });
});

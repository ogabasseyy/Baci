import { describe, expect, it } from '@jest/globals';
import { formatKoboToNaira } from './format-kobo-to-naira';

describe('formatKoboToNaira', () => {
  it('formats integer kobo with two fraction digits', () => {
    expect(formatKoboToNaira(9_500_000)).toBe('₦95,000.00');
    expect(formatKoboToNaira(1)).toBe('₦0.01');
    expect(formatKoboToNaira(0)).toBe('₦0.00');
  });
});

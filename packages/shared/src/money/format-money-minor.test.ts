import { describe, expect, it } from 'vitest';
import { formatMoneyMinor } from './format-money-minor';

const NBSP = '\u00A0';
const NNBSP = '\u202F';

describe('formatMoneyMinor', () => {
  it('scales 2-decimal currencies by 100', () => {
    expect(formatMoneyMinor(123450, 'NGN')).toBe('₦1,234.50');
    expect(
      formatMoneyMinor(123450, 'NGN', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      })
    ).toBe('₦1,235');
  });

  it('does not scale zero-decimal currencies', () => {
    expect(formatMoneyMinor(123450, 'XOF')).toBe(
      `123${NNBSP}450${NBSP}F${NNBSP}CFA`
    );
    expect(formatMoneyMinor(123450, 'XAF')).toBe(`123${NNBSP}450${NBSP}FCFA`);
    expect(formatMoneyMinor(123450, 'JPY')).toBe('JP¥123,450');
  });

  it('scales 3-decimal currencies by 1000', () => {
    expect(formatMoneyMinor(123456, 'KWD')).toBe(`KWD${NBSP}123.456`);
    expect(formatMoneyMinor(1, 'KWD')).toBe(`KWD${NBSP}0.001`);
  });

  it('rejects empty currency codes', () => {
    expect(() => formatMoneyMinor(1, '')).toThrow(RangeError);
  });
});

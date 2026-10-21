import { describe, expect, it } from 'vitest';
import type { FormatMoneyOptions } from './money-formatter';
import { getMoneyFormatter } from './money-formatter';

describe('money-formatter', () => {
  it('resolves a single fraction-digit bound without throwing', () => {
    expect(
      getMoneyFormatter('NGN', { maximumFractionDigits: 0 }).format(100)
    ).toBe('₦100');
    expect(
      getMoneyFormatter('NGN', { minimumFractionDigits: 3 }).format(100)
    ).toBe('₦100.000');
  });

  it('shares one formatter for logically identical options in any order', () => {
    const first = getMoneyFormatter('NGN', {
      currencyDisplay: 'code',
      signDisplay: 'always',
    });
    const second = getMoneyFormatter('NGN', {
      signDisplay: 'always',
      currencyDisplay: 'code',
    });
    expect(second).toBe(first);
  });

  it('cannot be overridden into another currency via options', () => {
    const rogue = {
      currency: 'USD',
      style: 'decimal',
    } as unknown as FormatMoneyOptions;
    expect(getMoneyFormatter('NGN', rogue).format(100)).toBe('₦100.00');
  });

  it('surfaces invalid currency and invalid explicit locale', () => {
    expect(() => getMoneyFormatter('NG')).toThrow(RangeError);
    expect(() => getMoneyFormatter('USD', { locale: '!!invalid!!' })).toThrow(
      RangeError
    );
  });

  it('equalizes fraction bounds for roundingIncrement > 1', () => {
    const options = { roundingIncrement: 5 } as FormatMoneyOptions;
    expect(getMoneyFormatter('NGN', options).format(1200)).toBe('₦1,200.00');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createMoneyFormatter } from './create-money-formatter';
import { formatMoney } from './format-money';

const NBSP = '\u00A0';
const NNBSP = '\u202F';

describe('createMoneyFormatter', () => {
  it('matches formatMoney for allowlisted 2-decimal currencies', () => {
    const format = createMoneyFormatter('NGN');
    expect(format(1234.5)).toBe('₦1,234.50');
    expect(format(1234.5)).toBe(formatMoney(1234.5, 'NGN'));
    expect(format(0)).toBe('₦0.00');
  });

  it('renders allowlisted zero-decimal currencies as whole units', () => {
    expect(createMoneyFormatter('XOF')(1234.5)).toBe(
      `1${NNBSP}235${NBSP}F${NNBSP}CFA`
    );
    expect(createMoneyFormatter('XAF')(1234.5)).toBe(`1${NNBSP}235${NBSP}FCFA`);
  });

  it('keeps legacy 2-digit rendering for non-allowlisted currencies', () => {
    // Table-only receipt path: no Intl exponent derivation, unlike
    // formatMoney (which renders JPY whole — see format-money.test.ts).
    expect(createMoneyFormatter('JPY')(1234.5)).toBe('JP¥1,234.50');
    expect(createMoneyFormatter('KWD')(123.456)).toBe(`KWD${NBSP}123.46`);
  });

  it('performs no Intl exponent derivation during construction', () => {
    // BHD is non-allowlisted and unused elsewhere in this file, so a
    // derivation would show up as a second Intl.NumberFormat call.
    const spy = vi.spyOn(Intl, 'NumberFormat');
    try {
      createMoneyFormatter('BHD');
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});

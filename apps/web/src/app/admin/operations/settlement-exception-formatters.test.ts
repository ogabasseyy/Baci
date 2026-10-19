import { describe, expect, it } from 'vitest';
import { settlementExceptionFormatters } from './settlement-exception-formatters';

describe('settlementExceptionFormatters', () => {
  it('marks currencyless settlement values as unavailable', () => {
    const row = { currency: null };

    expect(settlementExceptionFormatters.settlementMoney(null, row)).toBe(
      'Unavailable'
    );
    expect(settlementExceptionFormatters.currency(row.currency)).toBe(
      'Unavailable'
    );
  });

  it('preserves unknown-currency formatting for non-settlement rows', () => {
    expect(
      settlementExceptionFormatters.genericMoney(1200, { currency: null })
    ).toMatch(/^UNK /);
  });
});

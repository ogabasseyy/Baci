import { describe, expect, it } from 'vitest';
import { normalizeContentCurrencyTokens } from './normalize-content-currency-tokens';

describe('normalizeContentCurrencyTokens', () => {
  it('canonicalizes supported currency symbols to stable words', () => {
    const normalized = normalizeContentCurrencyTokens(
      'PSN Card £50, $50, €50, and ₦50'
    );

    expect(normalized).toBe('PSN Card gbp 50, usd 50, eur 50, and ngn 50');
  });

  it('canonicalizes compact US gift-card denominations', () => {
    const normalized = normalizeContentCurrencyTokens(
      'Steam US100 and Steam us10 Gift Card'
    );

    expect(normalized).toBe('Steam usd 100 and Steam usd 10 Gift Card');
  });

  it('canonicalizes US dollar prefixes before the generic dollar symbol', () => {
    const normalized = normalizeContentCurrencyTokens(
      'PSN US$50 and Steam US $100 Gift Cards'
    );

    expect(normalized).toBe('PSN usd 50 and Steam usd 100 Gift Cards');
  });

  it('canonicalizes compact ISO currency denominations', () => {
    const normalized = normalizeContentCurrencyTokens(
      'PSN USD50 and Xbox GBP50 Gift Cards'
    );

    expect(normalized).toBe('PSN USD 50 and Xbox GBP 50 Gift Cards');
  });

  it('canonicalizes formatted and zero-decimal gift-card amounts', () => {
    expect(
      normalizeContentCurrencyTokens('₦5,000 Gift Card and $50.00 Voucher')
    ).toBe('ngn 5000 Gift Card and usd 50 Voucher');
  });
});

import { describe, expect, it } from 'vitest';
import {
  formatMerchantAmount,
  formatMerchantPrice,
} from './format-merchant-currency';
import { formatCurrency } from './utils';

describe('formatMerchantAmount', () => {
  it('formats using the merchant payout currency and its home-market locale', () => {
    expect(formatMerchantAmount(1234.5, { payout_currency: 'INR' })).toBe(
      formatCurrency(1234.5, undefined, 'INR', 'en-IN')
    );
    expect(formatMerchantAmount(1234.5, { payout_currency: 'AED' })).toBe(
      formatCurrency(1234.5, undefined, 'AED', 'en-AE')
    );
  });

  it('trims and uppercases the payout currency before resolving', () => {
    expect(formatMerchantAmount(500, { payout_currency: ' inr ' })).toBe(
      formatCurrency(500, undefined, 'INR', 'en-IN')
    );
  });

  it('derives the currency from country when payout_currency is missing', () => {
    expect(
      formatMerchantAmount(2000, { country: 'IN', payout_currency: null })
    ).toBe(formatCurrency(2000, undefined, 'INR', 'en-IN'));
    expect(
      formatMerchantAmount(2000, { country: 'ae', payout_currency: '' })
    ).toBe(formatCurrency(2000, undefined, 'AED', 'en-AE'));
  });

  it('falls back to NGN when neither payout_currency nor country resolve', () => {
    expect(formatMerchantAmount(5000, null)).toBe(
      formatCurrency(5000, undefined, 'NGN', 'en-NG')
    );
    expect(formatMerchantAmount(5000, undefined)).toBe(
      formatCurrency(5000, undefined, 'NGN', 'en-NG')
    );
    expect(
      formatMerchantAmount(5000, { country: 'ZZ', payout_currency: 'BOGUS' })
    ).toBe(formatCurrency(5000, undefined, 'NGN', 'en-NG'));
  });

  it('produces the Naira glyph for NGN merchants', () => {
    expect(formatMerchantAmount(5000, { payout_currency: 'NGN' })).toBe(
      '₦5,000.00'
    );
  });

  it('passes through formatting options such as fraction digits', () => {
    expect(
      formatMerchantAmount(
        1000,
        { payout_currency: 'KES' },
        { maximumFractionDigits: 0, minimumFractionDigits: 0 }
      )
    ).toBe(
      formatCurrency(
        1000,
        { maximumFractionDigits: 0, minimumFractionDigits: 0 },
        'KES',
        'en-KE'
      )
    );
  });

  it('falls back to the runtime locale for currencies without a mapped locale', () => {
    expect(formatMerchantAmount(1000, { payout_currency: 'SEK' })).toBe(
      formatCurrency(1000, undefined, 'SEK', undefined)
    );
  });
});

describe('bugfix: prices rendered with a single trailing decimal digit', () => {
  it('shows two decimals when a price has kobo, e.g. ₦48,500.40', () => {
    expect(formatMerchantPrice(48500.4, { payout_currency: 'NGN' })).toBe(
      '₦48,500.40'
    );
  });

  it('drops the decimals for whole amounts', () => {
    expect(formatMerchantPrice(44850, { payout_currency: 'NGN' })).toBe(
      '₦44,850'
    );
  });

  it('keeps two decimals for amounts with two kobo digits', () => {
    expect(formatMerchantPrice(10552284.41, { payout_currency: 'NGN' })).toBe(
      '₦10,552,284.41'
    );
  });
});

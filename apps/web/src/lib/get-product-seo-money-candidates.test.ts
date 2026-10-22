import { describe, expect, it, vi } from 'vitest';
import { getProductSeoMoneyCandidates } from './get-product-seo-money-candidates';

describe('getProductSeoMoneyCandidates', () => {
  it.each([
    'missing',
    'throws',
  ] as const)('falls back to known currency codes when Intl.supportedValuesOf %s', async (mode) => {
    vi.resetModules();
    vi.stubGlobal('Intl', {
      supportedValuesOf:
        mode === 'missing'
          ? undefined
          : () => {
              throw new Error('unsupported currency key');
            },
    });
    try {
      const { getProductSeoMoneyCandidates: tokenize } = await import(
        './get-product-seo-money-candidates'
      );
      expect(tokenize('USD 50')).toMatchObject([
        { amount: 50, currencies: ['USD'] },
      ]);
      expect(tokenize('Buy this phone for CHF 900')).toMatchObject([
        { marker: 'CHF', amount: 900, currencies: ['CHF'] },
      ]);
      expect(tokenize('for 350,000')).toMatchObject([
        { marker: '', amount: 350_000, rawAmount: '350,000' },
      ]);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it.each([
    ['NGN350k', 350_000, ['NGN']],
    ['350k NGN', 350_000, ['NGN']],
    ['NGN 1.5m', 1_500_000, ['NGN']],
    ['NGN:350,000', 350_000, ['NGN']],
    ['USD: 900', 900, ['USD']],
    ['US$900', 900, ['USD']],
    ['₦: 350,000', 350_000, ['NGN']],
    ['350,000 naira', 350_000, ['NGN']],
    ['900 US dollars', 900, ['USD']],
    ['900 dollars', 900, ['currency-name:DOLLAR']],
    ['350 000', 350_000, []],
    ["350'000", 350_000, []],
    ['1.234,56 EUR', 1_234.56, ['EUR']],
    ['$50 CAD', 50, ['CAD']],
    ['900 dirhams', 900, ['AED']],
    ['900 shillings', 900, ['KES', 'TZS', 'UGX']],
    ['CAD $50', 50, ['CAD']],
    ['USD $50 CAD', 50, []],
    ['USD 50.00', 50, ['USD']],
    ['£50 USD', 50, []],
    ['N350,000', 350_000, ['NGN']],
    ['350000', 350_000, []],
  ])('parses a complete amount and explicit currency: %s', (text, amount, currencies) => {
    const candidates = getProductSeoMoneyCandidates(text);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      start: 0,
      end: text.length,
      amount,
      currencies,
    });
  });

  it('does not split amounts into model/specification suffixes', () => {
    expect(getProductSeoMoneyCandidates('RAM16GB 512GB 4,000mAh')).toEqual([]);
  });

  it('leaves ambiguous R16 classification to the copy policy', () => {
    expect(getProductSeoMoneyCandidates('R16')).toEqual([
      {
        start: 0,
        end: 3,
        marker: 'R',
        rawAmount: '16',
        amount: 16,
        currencies: ['ZAR'],
      },
    ]);
  });

  it('ignores malformed long runs without a timing-dependent assertion', () => {
    expect(getProductSeoMoneyCandidates(`${'1,'.repeat(4_000)}x`)).toEqual([]);
  });
});

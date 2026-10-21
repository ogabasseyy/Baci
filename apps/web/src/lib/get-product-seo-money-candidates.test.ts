import { describe, expect, it } from 'vitest';
import { getProductSeoMoneyCandidates } from './get-product-seo-money-candidates';

describe('getProductSeoMoneyCandidates', () => {
  it.each([
    ['NGN350k', 350_000, ['NGN']],
    ['350k NGN', 350_000, ['NGN']],
    ['NGN 1.5m', 1_500_000, ['NGN']],
    ['$50 CAD', 50, ['CAD']],
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

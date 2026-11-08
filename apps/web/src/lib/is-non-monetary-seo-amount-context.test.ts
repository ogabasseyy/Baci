import { describe, expect, it } from 'vitest';
import { retailRelation } from './classify-durable-product-seo-retail-relation';
import { getProductSeoMoneyCandidates } from './get-product-seo-money-candidates';
import { isNonMonetarySeoAmountContext } from './is-non-monetary-seo-amount-context';

describe('isNonMonetarySeoAmountContext', () => {
  it.each([
    'Available from 1 January 2026.',
    'Available from 1st of January 2026.',
    'Available from 2026-01-01.',
    'Available from 2026/01/01.',
    'Available from January 1, 2026.',
    'Available from 01-01-2026.',
    'Available from 1 Jan 2026.',
    'Available from 15 March.',
  ])('identifies bounded calendar dates as non-monetary: %s', (text) => {
    const candidates = getProductSeoMoneyCandidates(text);
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      const relation = retailRelation(text, candidate.start);
      expect(isNonMonetarySeoAmountContext(candidate, text, relation)).toBe(
        true
      );
    }
  });

  it('distinguishes calendar dates from actual prices in the same text', () => {
    const text = 'Available from 1 January 2026 for 999.';
    const candidates = getProductSeoMoneyCandidates(text);
    expect(candidates).toHaveLength(3);
    const dateCandidate1 = candidates[0];
    const dateCandidate2 = candidates[1];
    const priceCandidate = candidates[2];
    if (!dateCandidate1 || !dateCandidate2 || !priceCandidate) {
      throw new Error('Expected 3 candidates');
    }
    expect(
      isNonMonetarySeoAmountContext(
        dateCandidate1,
        text,
        retailRelation(text, dateCandidate1.start)
      )
    ).toBe(true);
    expect(
      isNonMonetarySeoAmountContext(
        dateCandidate2,
        text,
        retailRelation(text, dateCandidate2.start)
      )
    ).toBe(true);
    expect(
      isNonMonetarySeoAmountContext(
        priceCandidate,
        text,
        retailRelation(text, priceCandidate.start)
      )
    ).toBe(false);
  });

  it.each([
    'Starts at 10:30 am.',
    'Starts at 9:30 pm UTC.',
    'Event at 14:00 GMT.',
  ])('identifies clock times as non-monetary: %s', (text) => {
    const candidate = getProductSeoMoneyCandidates(text)[0];
    if (!candidate) throw new Error('Expected candidate');
    const relation = retailRelation(text, candidate.start);
    expect(isNonMonetarySeoAmountContext(candidate, text, relation)).toBe(true);
  });

  it('identifies parenthesized product years as non-monetary', () => {
    const text = 'Phone (2024).';
    const candidate = getProductSeoMoneyCandidates(text)[0];
    if (!candidate) throw new Error('Expected candidate');
    const relation = retailRelation(text, candidate.start);
    expect(isNonMonetarySeoAmountContext(candidate, text, relation)).toBe(true);
  });

  it.each([
    'Maximum load capacity is 900 pounds.',
    'Payload capacity is 1,200 pounds.',
  ])('identifies physical pounds weight context as non-monetary: %s', (text) => {
    const candidate = getProductSeoMoneyCandidates(text)[0];
    if (!candidate) throw new Error('Expected candidate');
    const relation = retailRelation(text, candidate.start);
    expect(isNonMonetarySeoAmountContext(candidate, text, relation)).toBe(true);
  });

  it('identifies short video resolution contexts as non-monetary', () => {
    const text = 'Supports 4k video recording';
    const candidate = getProductSeoMoneyCandidates(text)[0];
    if (!candidate) throw new Error('Expected candidate');
    const relation = retailRelation(text, candidate.start);
    expect(isNonMonetarySeoAmountContext(candidate, text, relation)).toBe(true);
  });

  it.each([
    'SAR 1.5 W/kg head SAR level',
    'Compatible with PHP 8.3 and MySQL 8',
    'COP 4.5 efficiency',
    'CAD 2024 software design tool',
    'AMD 7900 XT processors',
    'Powered by AMD 7000 processors',
  ])('identifies domain-specific non-monetary symbols and codes: %s', (text) => {
    const candidate = getProductSeoMoneyCandidates(text)[0];
    if (!candidate) throw new Error('Expected candidate');
    const relation = retailRelation(text, candidate.start);
    expect(isNonMonetarySeoAmountContext(candidate, text, relation)).toBe(true);
  });
});

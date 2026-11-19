import { describe, expect, it } from 'vitest';
import { analyzeFastCatalogBudget } from './fast-catalog-budget';

describe('fast catalog budget analysis', () => {
  it('uses the same attached-currency span for the limit and product query', () => {
    const result = analyzeFastCatalogBudget('Naira charger under 500k naira');
    expect(result.price).toEqual({ amount: 500_000, exclusive: true });
    expect(result.searchText.trim()).toBe('Naira charger');
    expect(result.invalid).toBe(false);
  });

  it.each([
    'under 1.2.3k',
    'under 500,00',
    'under 500 USD',
    'under $500',
  ])('rejects an incomplete or unsupported amount: %s', (text) => {
    expect(analyzeFastCatalogBudget(text).invalid).toBe(true);
  });

  it('does not equate an explicit naira budget with a different store currency', () => {
    expect(analyzeFastCatalogBudget('under 500k naira', 'USD').invalid).toBe(
      true
    );
  });

  it('retains a trailing sentence period after a valid numeric limit', () => {
    expect(analyzeFastCatalogBudget('under 500,000.').price).toEqual({
      amount: 500_000,
      exclusive: true,
    });
  });

  it('bounds work when many Max words appear in a customer message', () => {
    const text = 'max '.repeat(2_000);
    const result = analyzeFastCatalogBudget(text, 'NGN');
    expect(result.invalid).toBe(true);
    expect(result.searchText.trim()).toBe('');
  }, 10_000);

  it('removes many budget spans without repeated whole-string rewrites', () => {
    const result = analyzeFastCatalogBudget('under 1 '.repeat(2_000), 'NGN');
    expect(result.price).toEqual({ amount: 1, exclusive: true });
    expect(result.searchText.trim()).toBe('');
  }, 10_000);
});

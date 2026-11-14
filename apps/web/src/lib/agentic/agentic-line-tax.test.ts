import { describe, expect, it } from 'vitest';
import { calculateAgenticLineTax, TaxComputeError } from './agentic-line-tax';

describe('calculateAgenticLineTax', () => {
  it('rounds a taxable line using the order per-line formula', () => {
    expect(
      calculateAgenticLineTax({
        price: 1.05,
        quantity: 3,
        vatCategoryCode: 'S',
        vatRate: 7.5,
        vatRegistered: true,
      })
    ).toBe(0.24);
  });

  it('rounds PostgreSQL half-cent VAT upward for a 20-unit line', () => {
    expect(
      calculateAgenticLineTax({
        price: 0.41,
        quantity: 20,
        vatCategoryCode: 'S',
        vatRate: 7.5,
        vatRegistered: true,
      })
    ).toBe(0.62);
  });

  it('retains the full NUMERIC(5,2) VAT rate precision', () => {
    expect(
      calculateAgenticLineTax({
        price: 0.01,
        quantity: 1,
        vatCategoryCode: 'S',
        vatRate: '999.99',
        vatRegistered: true,
      })
    ).toBe(0.1);
  });

  it('returns zero for exempt categories and non-registered merchants', () => {
    const args = {
      price: 100,
      quantity: 2,
      vatRate: 7.5,
      vatRegistered: true,
    };
    expect(calculateAgenticLineTax({ ...args, vatCategoryCode: 'Z' })).toBe(0);
    expect(
      calculateAgenticLineTax({
        ...args,
        vatCategoryCode: 'S',
        vatRegistered: false,
      })
    ).toBe(0);
  });

  it('fails closed with product context for an invalid VAT rate', () => {
    expect(() =>
      calculateAgenticLineTax({
        price: 100,
        quantity: 1,
        vatCategoryCode: 'S',
        vatRate: 'invalid',
        vatRegistered: true,
        productId: 'product-1',
      })
    ).toThrowError(
      new TaxComputeError('Invalid vat_rate on product product-1: got invalid')
    );
  });
});

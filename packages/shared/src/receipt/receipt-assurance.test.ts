import { describe, expect, it } from 'vitest';
import {
  ASSURANCE_TAX_EXEMPTION_REASON,
  type AssuranceTaxSubtotalRow,
  reconcileAssuranceTaxSubtotals,
  sumAssuranceFeeTotals,
} from './receipt-assurance';

describe('sumAssuranceFeeTotals', () => {
  it('sums positive finite fees, ignoring missing and non-positive', () => {
    expect(
      sumAssuranceFeeTotals([
        { assurance_fee: 100 },
        { assurance_fee: '50' },
        { assurance_fee: null },
        { assurance_fee: -20 },
        null,
      ])
    ).toBe(150);
  });
});

describe('reconcileAssuranceTaxSubtotals', () => {
  it('adds ONLY the assurance premium to O for VAT orders', () => {
    const subtotals: AssuranceTaxSubtotalRow[] = [
      {
        vat_category_code: 'S',
        vat_rate: 7.5,
        taxable_amount: 100,
        tax_amount: 7.5,
      },
    ];
    reconcileAssuranceTaxSubtotals(subtotals, 4100, 4000);
    expect(subtotals).toHaveLength(2);
    expect(subtotals[1]).toMatchObject({
      vat_category_code: 'O',
      taxable_amount: 4000,
      tax_amount: 0,
      exemption_reason: ASSURANCE_TAX_EXEMPTION_REASON,
    });
  });

  it('reconciles the O bucket up to BT-109 for non-VAT orders', () => {
    const subtotals: AssuranceTaxSubtotalRow[] = [
      {
        vat_category_code: 'O',
        vat_rate: 0,
        taxable_amount: 1000,
        tax_amount: 0,
      },
    ];
    reconcileAssuranceTaxSubtotals(subtotals, 5000, 3000);
    expect(subtotals).toHaveLength(1);
    expect(subtotals[0].taxable_amount).toBe(5000);
  });

  it('does nothing when subtotals already span the target (non-VAT)', () => {
    const subtotals: AssuranceTaxSubtotalRow[] = [
      {
        vat_category_code: 'O',
        vat_rate: 0,
        taxable_amount: 5000,
        tax_amount: 0,
        exemption_reason: 'Outside scope of VAT',
      },
    ];
    reconcileAssuranceTaxSubtotals(subtotals, 5000, 3000);
    expect(subtotals).toHaveLength(1);
    expect(subtotals[0].taxable_amount).toBe(5000);
  });

  it('tolerates null rows and null fields', () => {
    const subtotals: Array<AssuranceTaxSubtotalRow | null> = [
      null,
      {
        vat_category_code: 'S',
        vat_rate: 7.5,
        taxable_amount: null,
        tax_amount: null,
      },
    ];
    reconcileAssuranceTaxSubtotals(subtotals, 100, 40);
    expect(subtotals).toHaveLength(3);
  });
});

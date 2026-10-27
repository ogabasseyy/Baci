import { describe, expect, it } from 'vitest';
import type { TaxSubtotal } from '@/lib/invoice-generator';
import {
  ASSURANCE_LINE_NAME,
  buildAssuranceInvoiceLineItem,
  buildAssuranceReceiptItem,
  nextInvoiceLineId,
  reconcileAssuranceTaxSubtotal,
  sumAssuranceFees,
  sumLineExtensionAmounts,
} from './insurance-assurance-line';

describe('sumAssuranceFees', () => {
  it('sums numeric and string fees, ignoring missing / non-positive', () => {
    expect(
      sumAssuranceFees([
        { assurance_fee: 1500 },
        { assurance_fee: '2500.5' },
        { assurance_fee: 0 },
        { assurance_fee: null },
        {},
      ])
    ).toBe(4000.5);
  });

  it('returns 0 when no item carries an assurance fee', () => {
    expect(sumAssuranceFees([{ assurance_fee: 0 }, {}])).toBe(0);
  });
});

describe('buildAssuranceInvoiceLineItem', () => {
  it('builds a zero-rated (O) line that reconciles to the fee total', () => {
    const line = buildAssuranceInvoiceLineItem(3, 4000);
    expect(line).toMatchObject({
      line_id: 3,
      name: ASSURANCE_LINE_NAME,
      quantity: 1,
      price: 4000,
      line_extension_amount: 4000,
      vat_category_code: 'O',
      vat_rate: 0,
      vat_amount: 0,
    });
  });
});

describe('buildAssuranceReceiptItem', () => {
  it('builds a receipt line item with the fee as the line total', () => {
    const item = buildAssuranceReceiptItem(4000);
    expect(item).toMatchObject({
      name: ASSURANCE_LINE_NAME,
      quantity: 1,
      price: 4000,
      line_extension_amount: 4000,
      vat_category_code: 'O',
      vat_amount: 0,
    });
  });
});

describe('nextInvoiceLineId', () => {
  it('returns one above the max existing line_id (handles sparse ids)', () => {
    expect(nextInvoiceLineId([{ line_id: 1 }, { line_id: 3 }])).toBe(4);
    expect(nextInvoiceLineId([{ line_id: 2 }])).toBe(3);
    expect(nextInvoiceLineId([{}, { line_id: null }])).toBe(1);
    expect(nextInvoiceLineId([])).toBe(1);
  });
});

describe('reconcileAssuranceTaxSubtotal', () => {
  it('adds ONLY the assurance premium to O for VAT orders (products in S)', () => {
    const subtotals: TaxSubtotal[] = [
      {
        vat_category_code: 'S',
        vat_rate: 7.5,
        taxable_amount: 100,
        tax_amount: 7.5,
      },
    ];
    // BT-109 = products(100) + assurance(4000); only the premium is O.
    reconcileAssuranceTaxSubtotal(subtotals, 4100, 4000);
    expect(subtotals).toHaveLength(2);
    expect(subtotals[1]).toMatchObject({
      vat_category_code: 'O',
      taxable_amount: 4000,
      tax_amount: 0,
    });
  });

  it('does not fold shipping/discount into O for VAT orders', () => {
    // S already includes shipping/discount (products 100 + shipping 50 - disc 10
    // = 140); BT-109 = 140 + assurance(30) = 170. Only 30 (the premium) is O.
    const subtotals: TaxSubtotal[] = [
      {
        vat_category_code: 'S',
        vat_rate: 7.5,
        taxable_amount: 140,
        tax_amount: 10.5,
      },
    ];
    reconcileAssuranceTaxSubtotal(subtotals, 170, 30);
    expect(subtotals).toHaveLength(2);
    expect(subtotals[0].taxable_amount).toBe(140); // S unchanged
    expect(subtotals[1]).toMatchObject({
      vat_category_code: 'O',
      taxable_amount: 30,
    });
  });

  it('reconciles the O bucket up to BT-109 for non-VAT orders', () => {
    // non-registered: single O taxable derived from tax_exclusive (products
    // only). BT-109 includes shipping/discount + assurance, all outside-scope.
    const subtotals: TaxSubtotal[] = [
      {
        vat_category_code: 'O',
        vat_rate: 0,
        taxable_amount: 1000,
        tax_amount: 0,
      },
    ];
    reconcileAssuranceTaxSubtotal(subtotals, 5000, 3000);
    expect(subtotals).toHaveLength(1);
    expect(subtotals[0].taxable_amount).toBe(5000);
  });

  it('does nothing when subtotals already span the target (non-VAT)', () => {
    const subtotals: TaxSubtotal[] = [
      {
        vat_category_code: 'O',
        vat_rate: 0,
        taxable_amount: 5000,
        tax_amount: 0,
        exemption_reason: 'Outside scope of VAT',
      },
    ];
    reconcileAssuranceTaxSubtotal(subtotals, 5000, 3000);
    expect(subtotals).toHaveLength(1);
    expect(subtotals[0].taxable_amount).toBe(5000);
  });

  it('reconciles a genuine one-cent assurance premium (VAT order)', () => {
    const subtotals: TaxSubtotal[] = [
      {
        vat_category_code: 'S',
        vat_rate: 7.5,
        taxable_amount: 100,
        tax_amount: 7.5,
      },
    ];
    reconcileAssuranceTaxSubtotal(subtotals, 100.01, 0.01);
    expect(subtotals).toHaveLength(2);
    expect(subtotals[1]).toMatchObject({
      vat_category_code: 'O',
      taxable_amount: 0.01,
      tax_amount: 0,
    });
  });
});

describe('sumLineExtensionAmounts', () => {
  it('sums line extension amounts, ignoring missing', () => {
    expect(
      sumLineExtensionAmounts([
        { line_extension_amount: 100 },
        { line_extension_amount: 4000 },
        {},
      ])
    ).toBe(4100);
  });
});

describe('ASSURANCE_LINE_NAME', () => {
  it('matches the shared canonical name so web and mobile itemize identically', async () => {
    const shared = await import('@baci/shared/receipt');
    expect(ASSURANCE_LINE_NAME).toBe(shared.ASSURANCE_LINE_NAME);
  });
});

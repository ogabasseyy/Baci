import { describe, expect, it } from 'vitest';
import { buildInvoiceContent } from './storefront-account-document-invoice-lines';

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    order: { tax_exclusive_amount: null, fulfillment_details: null },
    merchant: { vat_registration_status: 'unregistered', vat_rate: null },
    orderItems: [],
    itemRows: [],
    taxRows: [],
    taxAmount: 0,
    subtotal: 0,
    shippingFee: 0,
    discountAmount: 0,
    preTaxTotal: 0,
    taxInclusiveAmount: 0,
    ...overrides,
  };
}

describe('buildInvoiceContent', () => {
  it('falls back to a zero-rated bucket for non-VAT merchants', () => {
    const result = buildInvoiceContent(
      baseInput({ subtotal: 100, preTaxTotal: 90, taxInclusiveAmount: 90 })
    );

    expect(result.invoiceItems).toEqual([]);
    expect(result.assuranceTotal).toBe(0);
    expect(result.taxSubtotals).toEqual([
      {
        vat_category_code: 'O',
        vat_rate: 0,
        taxable_amount: 90,
        tax_amount: 0,
        exemption_reason: 'Seller is not VAT registered',
      },
    ]);
    expect(result.documentTaxExclusive).toBe(90);
    expect(result.documentTaxInclusive).toBe(90);
  });

  it('falls back to a standard-rated bucket for VAT merchants', () => {
    const result = buildInvoiceContent(
      baseInput({
        merchant: { vat_registration_status: 'registered', vat_rate: 7.5 },
        taxAmount: 7.5,
        subtotal: 100,
        preTaxTotal: 100,
        taxInclusiveAmount: 107.5,
      })
    );

    expect(result.taxSubtotals).toEqual([
      {
        vat_category_code: 'S',
        vat_rate: 7.5,
        taxable_amount: 100,
        tax_amount: 7.5,
      },
    ]);
    expect(result.documentTaxExclusive).toBe(100);
    expect(result.documentTaxInclusive).toBe(107.5);
  });

  it('carries explicit per-line VAT classification', () => {
    const result = buildInvoiceContent(
      baseInput({
        merchant: { vat_registration_status: 'registered', vat_rate: 7.5 },
        orderItems: [
          {
            id: 'item-1',
            product_id: 'product-1',
            name: 'Phone',
            quantity: 2,
            price: 50,
            vat_category_code: 'S',
            vat_rate: 7.5,
            vat_amount: 7.5,
          },
        ],
        taxAmount: 7.5,
        subtotal: 100,
        preTaxTotal: 100,
        taxInclusiveAmount: 107.5,
      })
    );

    expect(result.invoiceItems).toHaveLength(1);
    expect(result.invoiceItems[0]).toMatchObject({
      line_id: 1,
      quantity: 2,
      price: 50,
      line_extension_amount: 100,
      vat_category_code: 'S',
      vat_rate: 7.5,
      vat_amount: 7.5,
    });
  });

  it('itemizes assurance fees as a zero-rated line with reconciled totals', () => {
    const result = buildInvoiceContent(
      baseInput({
        orderItems: [
          {
            id: 'item-1',
            product_id: 'product-1',
            name: 'Phone',
            quantity: 1,
            price: 100,
          },
        ],
        itemRows: [{ assurance_fee: 500 }],
        subtotal: 600,
        preTaxTotal: 600,
        taxInclusiveAmount: 600,
      })
    );

    expect(result.assuranceTotal).toBe(500);
    expect(result.invoiceItems).toHaveLength(2);
    expect(result.documentTaxExclusive).toBe(600);
    expect(result.documentTaxInclusive).toBe(600);
  });
});

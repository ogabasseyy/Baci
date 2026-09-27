// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type { InvoiceData } from '@/lib/invoice-generator';
import * as invoiceGenerator from '@/lib/invoice-generator';

function createInvoiceData(overrides: Partial<InvoiceData> = {}): InvoiceData {
  return {
    invoice_number: 'INV-2026-001',
    invoice_type_code: '380',
    issue_date: new Date('2026-05-30T00:00:00.000Z'),
    due_date: new Date('2026-06-06T00:00:00.000Z'),
    currency: 'NGN',
    merchant: {
      business_name: 'Ogabassey',
      legal_entity_name: 'Ogabassey Limited',
      tax_identification_number: 'TIN-123456',
      cac_rc_number: 'RC-123456',
      vat_registration_status: 'registered',
      vat_rate: 7.5,
      registered_address: {
        street: '12 Allen Avenue',
        city: 'Ikeja',
        state: 'Lagos',
        postal_code: '100271',
        country: 'NG',
      },
      support_email: 'support@example.com',
      support_phone: '+2348012345678',
    },
    customer: {
      name: 'Akinola Ogunniran',
      email: 'akin@example.com',
      phone: '+2348098765432',
      address: {
        street: '8 Marina Road',
        city: 'Lagos Island',
        state: 'Lagos',
        postal_code: '101001',
        country: 'NG',
      },
    },
    items: [
      {
        line_id: 1,
        name: 'Samsung Galaxy S24 Ultra',
        description: 'Unlocked 256GB device',
        quantity: 1,
        unit_code: 'EA',
        price: 500000,
        line_extension_amount: 500000,
        vat_category_code: 'S',
        vat_rate: 7.5,
        vat_amount: 37500,
        sellers_item_id: 'SKU-S24-256',
      },
    ],
    tax_subtotals: [
      {
        vat_category_code: 'S',
        vat_rate: 7.5,
        taxable_amount: 500000,
        tax_amount: 37500,
      },
    ],
    subtotal: 500000,
    tax_exclusive_amount: 500000,
    tax_amount: 37500,
    tax_inclusive_amount: 537500,
    shipping_fee: 5000,
    discount_amount: 0,
    total: 542500,
    notes: 'Thank you for shopping with us.',
    payment_terms: 'Due on receipt',
    ...overrides,
  };
}

describe('invoice-generator single-template guard', () => {
  it('exposes no PDF renderer — the branded receipt renderer is the only invoice PDF path', () => {
    expect(
      (invoiceGenerator as Record<string, unknown>).generateInvoicePDF
    ).toBeUndefined();
    expect(
      (invoiceGenerator as Record<string, unknown>).generateInvoicePdf
    ).toBeUndefined();
  });

  it('keeps the shared invoice data model intact for Peppol/FIRS builders', () => {
    const data = createInvoiceData({
      firs_irn: 'IRN-123',
      firs_csid: 'CSID-456',
    });

    expect(data.invoice_number).toBe('INV-2026-001');
    expect(data.tax_subtotals).toHaveLength(1);
    expect(data.firs_irn).toBe('IRN-123');
    expect(data.firs_csid).toBe('CSID-456');
  });
});

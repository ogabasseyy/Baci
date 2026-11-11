import type { ReceiptMerchant, ReceiptOrder } from '@baci/shared';
import { describe, expect, it, vi } from 'vitest';
import type { InvoiceData } from '@/lib/invoice-generator';
import {
  generateReceiptBlob,
  resolveReceiptLogoDataUri,
} from '@/lib/receipt-pdf-generator';
import { buildInvoicePdfResponse } from './build-invoice-pdf-response';

vi.mock('@/lib/receipt-pdf-generator', () => ({
  generateReceiptBlob: vi.fn(),
  resolveReceiptLogoDataUri: vi.fn(),
}));

describe('buildInvoicePdfResponse', () => {
  it('passes branding and invoice options to the shared proforma PDF renderer', async () => {
    const logoDataUri = 'data:image/png;base64,AAAA';
    const merchant: ReceiptMerchant = {
      business_name: 'Merchant',
      email: 'seller@example.test',
      logo_url: null,
      phone: null,
      support_email: null,
      support_phone: null,
      business_address: null,
      cac_rc_number: null,
      tax_identification_number: null,
      legal_entity_name: null,
      vat_registration_status: null,
      vat_rate: null,
      bank_code: null,
      bank_account_number: null,
    };
    vi.mocked(resolveReceiptLogoDataUri).mockResolvedValueOnce(logoDataUri);
    vi.mocked(generateReceiptBlob).mockResolvedValueOnce(new Blob(['%PDF']));
    const issueDate = new Date('2026-11-10');
    const dueDate = new Date('2026-11-11');
    const invoice: InvoiceData = {
      invoice_number: 'PF-100',
      invoice_type_code: '325',
      issue_date: issueDate,
      due_date: dueDate,
      buyer_reference: 'BUYER-100',
      notes: 'Invoice note',
      currency: 'NGN',
      merchant: {
        business_name: 'Merchant',
        vat_registration_status: 'unregistered',
        vat_rate: 0,
      },
      customer: { name: 'Customer' },
      items: [],
      tax_subtotals: [],
      subtotal: 100,
      tax_exclusive_amount: 100,
      tax_amount: 0,
      tax_inclusive_amount: 100,
      shipping_fee: 0,
      discount_amount: 0,
      total: 100,
    };
    const order: ReceiptOrder = {
      order_number: invoice.invoice_number,
      created_at: issueDate.toISOString(),
      currency: invoice.currency,
      total: invoice.total,
      subtotal: invoice.subtotal,
      shipping_fee: invoice.shipping_fee,
      tax_amount: invoice.tax_amount,
      discount_amount: invoice.discount_amount,
      amount_paid: 0,
      balance: invoice.total,
      payment_status: 'unpaid',
      payment_method: null,
      customer_name: invoice.customer.name,
      customer_email: null,
      customer_phone: null,
      items: [],
    };

    const response = await buildInvoicePdfResponse(
      'order-id',
      invoice,
      order,
      merchant
    );

    expect(generateReceiptBlob).toHaveBeenCalledWith(
      order,
      merchant,
      expect.objectContaining({
        buyerReference: 'BUYER-100',
        documentDate: issueDate,
        documentKind: 'proforma_invoice',
        dueDate,
        invoiceNotes: 'Invoice note',
        logoDataUri,
      })
    );
    expect(response.headers.get('content-disposition')).toContain(
      'proforma-PF-100.pdf'
    );
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.text()).toBe('%PDF');
  });
});

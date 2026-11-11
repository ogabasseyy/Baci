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
    const logo = { business_name: 'Merchant', email: 'seller@example.test' };
    vi.mocked(resolveReceiptLogoDataUri).mockResolvedValueOnce(logoDataUri);
    vi.mocked(generateReceiptBlob).mockResolvedValueOnce(new Blob(['%PDF']));
    const invoice = {
      invoice_number: 'PF-100',
      invoice_type_code: '325',
      issue_date: '2026-11-10',
      due_date: '2026-11-11',
      buyer_reference: 'BUYER-100',
      notes: 'Invoice note',
    } as InvoiceData;
    const order = {} as Parameters<typeof buildInvoicePdfResponse>[2];

    const response = await buildInvoicePdfResponse(
      'order-id',
      invoice,
      order,
      logo
    );

    expect(generateReceiptBlob).toHaveBeenCalledWith(
      order,
      logo,
      expect.objectContaining({
        buyerReference: 'BUYER-100',
        documentDate: '2026-11-10',
        documentKind: 'proforma_invoice',
        dueDate: '2026-11-11',
        invoiceNotes: 'Invoice note',
        logoDataUri,
      })
    );
    expect(response.headers.get('content-disposition')).toContain(
      'proforma-PF-100.pdf'
    );
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(await response.text()).toBe('%PDF');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { manualDocumentMerchantSchema } from '@/schemas/manual-order-document-merchant';
import { manualDocumentOrderSchema } from '@/schemas/manual-order-document-order';
import {
  merchantFixture,
  orderFixture,
} from './manual-order-document.test-utils';
import { renderManualOrderDocumentPdf } from './render-manual-order-document-pdf';

vi.mock('@/lib/receipt-pdf-generator', () => ({
  generateReceiptPDF: vi.fn(() => ({ output: () => 'pdf-bytes' })),
  resolveReceiptLogoDataUri: vi.fn(async () => null),
}));

import { generateReceiptPDF } from '@/lib/receipt-pdf-generator';

const mockedPdf = vi.mocked(generateReceiptPDF);

describe('render manual order document pdf VAT synthesis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('synthesizes an S subtotal for direct manual orders like the download', async () => {
    // Mobile-admin direct orders persist only the aggregate tax_amount
    // with no order_tax_subtotals rows: without the download path's
    // empty-row fallback the emailed invoice omits the VAT Breakdown.
    const order = manualDocumentOrderSchema.parse({
      ...orderFixture,
      tax_amount: 71250,
    });
    const merchant = manualDocumentMerchantSchema.parse({
      ...merchantFixture,
      vat_registration_status: 'registered',
      vat_rate: 7.5,
    });

    const rendered = await renderManualOrderDocumentPdf({
      taxRows: [],
      transactionRows: [],
      order,
      merchant,
      recipientEmail: 'ada@example.com',
      preferredPaymentAccount: null,
      isPaid: false,
      pdfDocumentKind: 'invoice',
      invoiceTypeCode: '380',
    });

    expect(mockedPdf).toHaveBeenCalledOnce();
    const [, , options] = mockedPdf.mock.calls[0];
    expect(options?.taxSubtotals).toEqual([
      {
        vat_category_code: 'S',
        vat_rate: 7.5,
        taxable_amount: 950000,
        tax_amount: 71250,
      },
    ]);
    // The dispatch marker snapshots the stored rows, not the synthesis.
    expect(rendered.taxSubtotals).toEqual([]);
  });
});

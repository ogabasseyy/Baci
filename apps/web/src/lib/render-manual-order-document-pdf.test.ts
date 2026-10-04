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

describe('render manual order document pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes payment history, tax breakdown, and invoice notes to the renderer', async () => {
    // Rows arrive pre-filtered from the claim-bound snapshot (settled
    // payments only, both settled statuses): the RPC filters once.
    const transactionRows = [
      {
        id: 'txn-1',
        amount: 500000,
        created_at: '2026-09-29T09:00:00Z',
        description: null,
        metadata: { payment_method: 'bank_transfer' },
      },
      {
        id: 'txn-2',
        amount: 450000,
        created_at: '2026-09-30T09:00:00Z',
        description: 'balance',
        metadata: null,
      },
    ];
    const taxRows = [
      {
        id: 'tax-1',
        vat_category_code: 'S',
        vat_rate: 7.5,
        taxable_amount: 883721,
        tax_amount: 66279,
        exemption_reason: null,
      },
    ];
    const order = manualDocumentOrderSchema.parse({
      ...orderFixture,
      invoice_note: null,
      notes: 'Call before delivery',
    });
    const merchant = manualDocumentMerchantSchema.parse(merchantFixture);

    const rendered = await renderManualOrderDocumentPdf({
      taxRows: taxRows,
      transactionRows: transactionRows,
      order,
      merchant,
      recipientEmail: 'ada@example.com',
      preferredPaymentAccount: null,
      isPaid: true,
      pdfDocumentKind: 'receipt',
      invoiceTypeCode: null,
    });

    expect(mockedPdf).toHaveBeenCalledOnce();
    expect(rendered.taxSubtotals).toEqual([
      {
        id: 'tax-1',
        exemption_reason: null,
        taxable_amount: 883721,
        tax_amount: 66279,
        vat_category_code: 'S',
        vat_rate: 7.5,
      },
    ]);
    const [receiptOrder, , options] = mockedPdf.mock.calls[0];
    expect(receiptOrder.transactions).toHaveLength(2);
    expect(receiptOrder.transactions?.[0]).toMatchObject({
      amount: 500000,
      metadata: { payment_method: 'bank_transfer' },
    });
    expect(options?.taxSubtotals).toEqual([
      {
        exemption_reason: null,
        taxable_amount: 883721,
        tax_amount: 66279,
        vat_category_code: 'S',
        vat_rate: 7.5,
      },
    ]);
    expect(options?.invoiceNotes).toBe('Call before delivery');
    expect(rendered.transactions).toEqual([
      {
        id: 'txn-1',
        amount: 500000,
        created_at: '2026-09-29T09:00:00Z',
        description: null,
        metadata: { payment_method: 'bank_transfer' },
      },
      {
        id: 'txn-2',
        amount: 450000,
        created_at: '2026-09-30T09:00:00Z',
        description: 'balance',
        metadata: null,
      },
    ]);
  });

  it('dates an unpaid emailed invoice from the transaction date like the download', async () => {
    const order = manualDocumentOrderSchema.parse({
      ...orderFixture,
      invoice_issue_date: null,
      payment_due_date: null,
      payment_terms: null,
      buyer_reference: null,
      firs_irn: null,
      firs_csid: null,
      payment_status: 'unpaid',
      amount_paid: 0,
    });
    const merchant = manualDocumentMerchantSchema.parse(merchantFixture);

    await renderManualOrderDocumentPdf({
      taxRows: [],
      transactionRows: [],
      order,
      merchant,
      recipientEmail: 'ada@example.com',
      preferredPaymentAccount: null,
      isPaid: false,
      pdfDocumentKind: 'invoice',
      invoiceTypeCode: null,
    });

    const [, , options] = mockedPdf.mock.calls[0];
    // Matches receipt-pdf-generator's invoice_issue_date ?? transaction_date
    // ?? created_at chain: transaction_date wins over created_at.
    expect(options?.documentDate).toBe('2026-09-28T09:00:00Z');
  });

  it('prefers the explicit invoice note over staff order notes', async () => {
    const order = manualDocumentOrderSchema.parse({
      ...orderFixture,
      invoice_note: 'FIRS e-invoice note',
      notes: 'staff note',
    });
    const merchant = manualDocumentMerchantSchema.parse(merchantFixture);

    await renderManualOrderDocumentPdf({
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

    expect(mockedPdf.mock.calls[0][2]?.invoiceNotes).toBe(
      'FIRS e-invoice note'
    );
  });

  it('normalizes the mobile camelCase postal code into the document address', async () => {
    const order = manualDocumentOrderSchema.parse({
      ...orderFixture,
      shipping_address: { city: 'Lagos', postalCode: '100001' },
    });
    const merchant = manualDocumentMerchantSchema.parse(merchantFixture);

    await renderManualOrderDocumentPdf({
      taxRows: [],
      transactionRows: [],
      order,
      merchant,
      recipientEmail: 'ada@example.com',
      preferredPaymentAccount: null,
      isPaid: true,
      pdfDocumentKind: 'receipt',
      invoiceTypeCode: null,
    });

    expect(mockedPdf.mock.calls[0][0].shipping_address).toMatchObject({
      city: 'Lagos',
      postal_code: '100001',
    });
  });

  it('passes invoice terms and fiscal references to the renderer like the account download', async () => {
    const order = manualDocumentOrderSchema.parse({
      ...orderFixture,
      payment_due_date: '2026-10-15',
      payment_terms: 'Net 30',
      buyer_reference: 'BUYER-1',
      firs_irn: 'IRN-1',
      firs_csid: 'CSID-1',
    });
    const merchant = manualDocumentMerchantSchema.parse(merchantFixture);

    await renderManualOrderDocumentPdf({
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

    const [, , options] = mockedPdf.mock.calls[0];
    expect(options).toMatchObject({
      buyerReference: 'BUYER-1',
      dueDate: '2026-10-15',
      firsCsid: 'CSID-1',
      firsIrn: 'IRN-1',
      paymentTerms: 'Net 30',
    });
  });
});

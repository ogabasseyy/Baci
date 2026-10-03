import { beforeEach, describe, expect, it, vi } from 'vitest';
import { manualDocumentMerchantSchema } from '@/schemas/manual-order-document-merchant';
import { manualDocumentOrderSchema } from '@/schemas/manual-order-document-order';
import {
  database,
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
    const db = database(
      { invoice_note: null, notes: 'Call before delivery' },
      {
        paymentHistory: [
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
        ],
        taxSubtotals: [
          {
            id: 'tax-1',
            vat_category_code: 'S',
            vat_rate: 7.5,
            taxable_amount: 883721,
            tax_amount: 66279,
            exemption_reason: null,
          },
        ],
      }
    );
    const order = manualDocumentOrderSchema.parse({
      ...orderFixture,
      invoice_note: null,
      notes: 'Call before delivery',
    });
    const merchant = manualDocumentMerchantSchema.parse(merchantFixture);

    const rendered = await renderManualOrderDocumentPdf({
      supabase: db.client,
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
    // Paystack-backed payments settle as 'success': both settled statuses
    // must reach the payment table, not just manual 'completed' rows.
    expect(db.filters['transactions.status']).toEqual(['completed', 'success']);
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
    const db = database({}, { paymentHistory: [], taxSubtotals: [] });
    const order = manualDocumentOrderSchema.parse({
      ...orderFixture,
      invoice_issue_date: null,
      payment_status: 'unpaid',
      amount_paid: 0,
    });
    const merchant = manualDocumentMerchantSchema.parse(merchantFixture);

    await renderManualOrderDocumentPdf({
      supabase: db.client,
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
    const db = database();
    const order = manualDocumentOrderSchema.parse({
      ...orderFixture,
      invoice_note: 'FIRS e-invoice note',
      notes: 'staff note',
    });
    const merchant = manualDocumentMerchantSchema.parse(merchantFixture);

    await renderManualOrderDocumentPdf({
      supabase: db.client,
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
    const db = database();
    const order = manualDocumentOrderSchema.parse({
      ...orderFixture,
      shipping_address: { city: 'Lagos', postalCode: '100001' },
    });
    const merchant = manualDocumentMerchantSchema.parse(merchantFixture);

    await renderManualOrderDocumentPdf({
      supabase: db.client,
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

  it('throws for retry when the payment history lookup fails', async () => {
    const db = database(
      {},
      { paymentHistoryError: { message: 'ledger down' } }
    );
    const order = manualDocumentOrderSchema.parse(orderFixture);
    const merchant = manualDocumentMerchantSchema.parse(merchantFixture);

    await expect(
      renderManualOrderDocumentPdf({
        supabase: db.client,
        order,
        merchant,
        recipientEmail: 'ada@example.com',
        preferredPaymentAccount: null,
        isPaid: true,
        pdfDocumentKind: 'receipt',
        invoiceTypeCode: null,
      })
    ).rejects.toThrow('Manual document payment history unavailable');
    expect(mockedPdf).not.toHaveBeenCalled();
  });

  it('throws for retry when the tax breakdown lookup fails', async () => {
    const db = database({}, { taxSubtotalsError: { message: 'vat down' } });
    const order = manualDocumentOrderSchema.parse(orderFixture);
    const merchant = manualDocumentMerchantSchema.parse(merchantFixture);

    await expect(
      renderManualOrderDocumentPdf({
        supabase: db.client,
        order,
        merchant,
        recipientEmail: 'ada@example.com',
        preferredPaymentAccount: null,
        isPaid: false,
        pdfDocumentKind: 'invoice',
        invoiceTypeCode: '380',
      })
    ).rejects.toThrow('Manual document tax breakdown unavailable');
    expect(mockedPdf).not.toHaveBeenCalled();
  });
});

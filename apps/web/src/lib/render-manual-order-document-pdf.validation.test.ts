import { beforeEach, describe, expect, it, vi } from 'vitest';
import { manualDocumentMerchantSchema } from '@/schemas/manual-order-document-merchant';
import { manualDocumentOrderSchema } from '@/schemas/manual-order-document-order';
import {
  database,
  merchantFixture,
  orderFixture,
} from './manual-order-document.test-utils';
import {
  ManualDocumentValidationError,
  renderManualOrderDocumentPdf,
} from './render-manual-order-document-pdf';

vi.mock('@/lib/receipt-pdf-generator', () => ({
  generateReceiptPDF: vi.fn(() => ({ output: () => 'pdf-bytes' })),
  resolveReceiptLogoDataUri: vi.fn(async () => null),
}));

import { generateReceiptPDF } from '@/lib/receipt-pdf-generator';

const mockedPdf = vi.mocked(generateReceiptPDF);

describe('render manual order document pdf child-row validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails a negative VAT breakdown closed instead of emailing it', async () => {
    const db = database(
      {},
      {
        paymentHistory: [],
        taxSubtotals: [
          {
            id: 'tax-1',
            vat_category_code: 'S',
            vat_rate: -7.5,
            taxable_amount: 883721,
            tax_amount: 66279,
            exemption_reason: null,
          },
        ],
      }
    );
    const order = manualDocumentOrderSchema.parse(orderFixture);
    const merchant = manualDocumentMerchantSchema.parse(merchantFixture);

    const error = await renderManualOrderDocumentPdf({
      supabase: db.client,
      order,
      merchant,
      recipientEmail: 'ada@example.com',
      preferredPaymentAccount: null,
      isPaid: false,
      pdfDocumentKind: 'invoice',
      invoiceTypeCode: '380',
    }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ManualDocumentValidationError);
    expect((error as ManualDocumentValidationError).reason).toBe(
      'tax_breakdown_invalid'
    );
    expect(mockedPdf).not.toHaveBeenCalled();
  });

  it('fails a negative settled payment closed instead of emailing it', async () => {
    const db = database(
      {},
      {
        paymentHistory: [
          {
            id: 'txn-1',
            amount: -50000,
            created_at: '2026-09-29T09:00:00Z',
            description: null,
            metadata: null,
          },
        ],
        taxSubtotals: [],
      }
    );
    const order = manualDocumentOrderSchema.parse(orderFixture);
    const merchant = manualDocumentMerchantSchema.parse(merchantFixture);

    const error = await renderManualOrderDocumentPdf({
      supabase: db.client,
      order,
      merchant,
      recipientEmail: 'ada@example.com',
      preferredPaymentAccount: null,
      isPaid: true,
      pdfDocumentKind: 'receipt',
      invoiceTypeCode: null,
    }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ManualDocumentValidationError);
    expect((error as ManualDocumentValidationError).reason).toBe(
      'payment_history_invalid'
    );
    expect(mockedPdf).not.toHaveBeenCalled();
  });

  it('renders receipts despite tax rows they never print', async () => {
    const db = database(
      {},
      {
        paymentHistory: [],
        taxSubtotals: [
          {
            id: 'tax-1',
            vat_category_code: 'S',
            vat_rate: -7.5,
            taxable_amount: 883721,
            tax_amount: 66279,
            exemption_reason: null,
          },
        ],
      }
    );
    const order = manualDocumentOrderSchema.parse(orderFixture);
    const merchant = manualDocumentMerchantSchema.parse(merchantFixture);

    // Receipts render no tax breakdown (and the atomic snapshot skips the
    // tax compare for them), so corrupt tax must not block a receipt send.
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
    expect(mockedPdf).toHaveBeenCalledOnce();
  });
});

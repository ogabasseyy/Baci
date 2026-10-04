import type { z } from 'zod';
import { buildManualOrderDocumentPdfInput } from '@/lib/build-manual-order-document-pdf-input';
import type {
  DispatchTaxSubtotal,
  DispatchTransaction,
} from '@/lib/mark-manual-document-dispatch-started';
import {
  generateReceiptPDF,
  resolveReceiptLogoDataUri,
} from '@/lib/receipt-pdf-generator';
import { selectReceiptCompletionDate } from '@/lib/resolve-manual-document-receipt-date';
import type { manualDocumentMerchantSchema } from '@/schemas/manual-order-document-merchant';
import type { manualDocumentOrderSchema } from '@/schemas/manual-order-document-order';

/**
 * Deterministic shape failure in the rendered child rows (negative VAT or
 * payment amounts the database permits but no document may print). The
 * sender converts these to skipped — later triggers re-arm — instead of
 * throwing into max_attempts retries like transient lookup failures.
 */
export class ManualDocumentValidationError extends Error {
  readonly reason: 'payment_history_invalid' | 'tax_breakdown_invalid';

  constructor(reason: 'payment_history_invalid' | 'tax_breakdown_invalid') {
    super(`Manual document ${reason}`);
    this.name = 'ManualDocumentValidationError';
    this.reason = reason;
  }
}

type SnapshotChildRow = {
  id?: unknown;
  amount?: unknown;
  created_at?: unknown;
  description?: unknown;
  metadata?: unknown;
  status?: unknown;
  transaction_type?: unknown;
  gateway?: unknown;
  vat_category_code?: unknown;
  vat_rate?: unknown;
  taxable_amount?: unknown;
  tax_amount?: unknown;
  exemption_reason?: unknown;
};

/**
 * Renders the emailed PDF from the canonical document data: the payment
 * history behind the receipt's Payment table, the VAT subtotal rows behind
 * the invoice's tax breakdown, and the merchant's invoice notes. Rows arrive
 * from the claim-bound dispatch snapshot (one RPC, no table reads): the
 * snapshot is atomic, so a mid-dispatch correction cannot land between the
 * render and the marker. The normalized tax and payment-history rows are
 * returned alongside the PDF so the dispatch marker snapshots exactly what
 * was rendered.
 */
export async function renderManualOrderDocumentPdf({
  taxRows,
  transactionRows,
  order,
  merchant,
  recipientEmail,
  preferredPaymentAccount,
  isPaid,
  pdfDocumentKind,
  invoiceTypeCode,
}: {
  taxRows: readonly unknown[];
  transactionRows: readonly unknown[];
  order: z.infer<typeof manualDocumentOrderSchema>;
  merchant: z.infer<typeof manualDocumentMerchantSchema>;
  recipientEmail: string;
  preferredPaymentAccount: {
    account_number: string;
    bank_name: string | null;
    account_name: string | null;
  } | null;
  isPaid: boolean;
  pdfDocumentKind: 'invoice' | 'proforma_invoice' | 'receipt';
  invoiceTypeCode: string | null;
}) {
  // Snapshot order (created_at, id), settled payments only: the RPC
  // filters once, so every reader shares the set. Order is preserved for
  // the PDF table; the dispatch params re-sort by id before the mark.
  const settledHistory = transactionRows as SnapshotChildRow[];
  const taxSubtotals: DispatchTaxSubtotal[] = (
    taxRows as SnapshotChildRow[]
  ).map((row) => ({
    id: String(row.id ?? ''),
    exemption_reason: (row.exemption_reason as string | null) ?? null,
    taxable_amount: Number(row.taxable_amount ?? 0),
    tax_amount: Number(row.tax_amount ?? 0),
    vat_category_code: String(row.vat_category_code ?? ''),
    vat_rate: Number(row.vat_rate ?? 0),
  }));
  // Null-preserving, unlike the PDF input below: the snapshot must compare
  // exactly what the database holds, so display fallbacks stay out.
  const transactions: DispatchTransaction[] = settledHistory.map((row) => ({
    id: String(row.id ?? ''),
    amount: (row.amount as number | null) ?? null,
    created_at: (row.created_at as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
  }));
  const renderTransactions = settledHistory.map((row) => ({
    amount: Number(row.amount ?? 0),
    created_at: String(row.created_at ?? ''),
    description: (row.description as string | null) ?? null,
    metadata: (row.metadata as { payment_method?: string } | null) ?? null,
  }));
  // Fail corrupt money closed before rendering: the database permits
  // negative VAT and payment amounts, but no emailed document may print
  // them. Receipts render no tax breakdown, so tax rows gate invoices
  // only; settled payments render on every kind.
  if (!isPaid) {
    for (const row of taxSubtotals) {
      const valid = [row.vat_rate, row.taxable_amount, row.tax_amount].every(
        (value) => Number.isFinite(value) && value >= 0
      );
      if (!valid)
        throw new ManualDocumentValidationError('tax_breakdown_invalid');
    }
  }
  for (const txn of renderTransactions) {
    if (!Number.isFinite(txn.amount) || txn.amount < 0) {
      throw new ManualDocumentValidationError('payment_history_invalid');
    }
  }
  const { receiptOrder, receiptMerchant } = buildManualOrderDocumentPdfInput({
    order,
    merchant,
    recipientEmail,
    preferredPaymentAccount,
    transactions: renderTransactions,
  });
  const receiptDate = isPaid
    ? selectReceiptCompletionDate(
        settledHistory as {
          created_at?: string | null;
          status?: string | null;
          transaction_type?: string | null;
        }[]
      )
    : null;
  const logoDataUri = await resolveReceiptLogoDataUri(receiptMerchant);
  const pdf = generateReceiptPDF(receiptOrder, receiptMerchant, {
    buyerReference: order.buyer_reference,
    documentKind: pdfDocumentKind,
    dueDate: order.payment_due_date,
    firsCsid: order.firs_csid,
    firsIrn: order.firs_irn,
    invoiceTypeCode,
    paymentTerms: order.payment_terms,
    documentDate:
      (isPaid
        ? (receiptDate ?? order.transaction_date)
        : (order.invoice_issue_date ?? order.transaction_date)) ||
      order.created_at,
    logoDataUri,
    invoiceNotes: order.invoice_note || order.notes || undefined,
    taxSubtotals: taxSubtotals.map(({ id: _id, ...breakdown }) => breakdown),
  });
  return { pdf, taxSubtotals, transactions };
}

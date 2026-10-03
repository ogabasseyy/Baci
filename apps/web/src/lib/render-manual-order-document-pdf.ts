import type { SupabaseClient } from '@supabase/supabase-js';
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
import { resolveManualDocumentReceiptDate } from '@/lib/resolve-manual-document-receipt-date';
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

/**
 * Renders the emailed PDF from the canonical document data: the payment
 * history behind the receipt's Payment table, the VAT subtotal rows behind
 * the invoice's tax breakdown, and the merchant's invoice notes. A failed
 * lookup throws into outbox retry like the receipt-date lookup: a sent
 * document is terminal, so swallowing the error would permanently mis-render
 * a financial document. The normalized tax and payment-history rows are
 * returned alongside the PDF so the dispatch marker snapshots exactly what
 * was rendered; a separate sender-side re-read could land on either side
 * of a mid-dispatch correction and either miss the staleness or cry stale
 * on a fresh render.
 */
export async function renderManualOrderDocumentPdf({
  supabase,
  order,
  merchant,
  recipientEmail,
  preferredPaymentAccount,
  isPaid,
  pdfDocumentKind,
  invoiceTypeCode,
}: {
  supabase: SupabaseClient;
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
  const [historyResult, taxResult] = await Promise.all([
    supabase
      .from('transactions')
      .select('id, amount, created_at, description, metadata')
      .eq('order_id', order.id)
      .eq('transaction_type', 'payment')
      // Paystack-backed payments settle as 'success', manual ones as
      // 'completed': the DVA reservation paths treat both as settled.
      .in('status', ['completed', 'success'])
      .order('created_at', { ascending: true }),
    supabase
      .from('order_tax_subtotals')
      .select(
        'id, vat_category_code, vat_rate, taxable_amount, tax_amount, exemption_reason'
      )
      .eq('order_id', order.id),
  ]);
  if (historyResult.error)
    throw new Error('Manual document payment history unavailable');
  if (taxResult.error)
    throw new Error('Manual document tax breakdown unavailable');
  const taxSubtotals: DispatchTaxSubtotal[] = (taxResult.data ?? []).map(
    (row) => ({
      id: String(row.id ?? ''),
      exemption_reason: (row.exemption_reason as string | null) ?? null,
      taxable_amount: Number(row.taxable_amount ?? 0),
      tax_amount: Number(row.tax_amount ?? 0),
      vat_category_code: String(row.vat_category_code ?? ''),
      vat_rate: Number(row.vat_rate ?? 0),
    })
  );
  // Null-preserving, unlike the PDF input below: the snapshot must compare
  // exactly what the database holds, so display fallbacks stay out.
  const transactions: DispatchTransaction[] = (historyResult.data ?? []).map(
    (row) => ({
      id: String(row.id ?? ''),
      amount: (row.amount as number | null) ?? null,
      created_at: (row.created_at as string | null) ?? null,
      description: (row.description as string | null) ?? null,
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    })
  );
  const renderTransactions = (historyResult.data ?? []).map((row) => ({
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
  const receiptDate = await resolveManualDocumentReceiptDate(
    supabase,
    order.id,
    isPaid
  );
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

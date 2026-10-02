import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import { buildManualOrderDocumentPdfInput } from '@/lib/build-manual-order-document-pdf-input';
import {
  generateReceiptPDF,
  resolveReceiptLogoDataUri,
} from '@/lib/receipt-pdf-generator';
import { resolveManualDocumentReceiptDate } from '@/lib/resolve-manual-document-receipt-date';
import type { manualDocumentMerchantSchema } from '@/schemas/manual-order-document-merchant';
import type { manualDocumentOrderSchema } from '@/schemas/manual-order-document-order';

/**
 * Renders the emailed PDF from the canonical document data: the payment
 * history behind the receipt's Payment table, the VAT subtotal rows behind
 * the invoice's tax breakdown, and the merchant's invoice notes. A failed
 * lookup throws into outbox retry like the receipt-date lookup: a sent
 * document is terminal, so swallowing the error would permanently mis-render
 * a financial document.
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
      .select('amount, created_at, description, metadata')
      .eq('order_id', order.id)
      .eq('transaction_type', 'payment')
      .eq('status', 'completed')
      .order('created_at', { ascending: true }),
    supabase
      .from('order_tax_subtotals')
      .select(
        'vat_category_code, vat_rate, taxable_amount, tax_amount, exemption_reason'
      )
      .eq('order_id', order.id),
  ]);
  if (historyResult.error)
    throw new Error('Manual document payment history unavailable');
  if (taxResult.error)
    throw new Error('Manual document tax breakdown unavailable');
  const { receiptOrder, receiptMerchant } = buildManualOrderDocumentPdfInput({
    order,
    merchant,
    recipientEmail,
    preferredPaymentAccount,
    transactions: (historyResult.data ?? []).map((row) => ({
      amount: Number(row.amount ?? 0),
      created_at: String(row.created_at ?? ''),
      description: (row.description as string | null) ?? null,
      metadata: (row.metadata as { payment_method?: string } | null) ?? null,
    })),
  });
  const receiptDate = await resolveManualDocumentReceiptDate(
    supabase,
    order.id,
    isPaid
  );
  const logoDataUri = await resolveReceiptLogoDataUri(receiptMerchant);
  return generateReceiptPDF(receiptOrder, receiptMerchant, {
    documentKind: pdfDocumentKind,
    invoiceTypeCode,
    documentDate:
      (isPaid
        ? (receiptDate ?? order.transaction_date)
        : order.invoice_issue_date) || order.created_at,
    logoDataUri,
    invoiceNotes: order.invoice_note || order.notes || undefined,
    taxSubtotals: (taxResult.data ?? []).map((row) => ({
      exemption_reason: (row.exemption_reason as string | null) ?? null,
      taxable_amount: Number(row.taxable_amount ?? 0),
      tax_amount: Number(row.tax_amount ?? 0),
      vat_category_code: String(row.vat_category_code ?? ''),
      vat_rate: Number(row.vat_rate ?? 0),
    })),
  });
}

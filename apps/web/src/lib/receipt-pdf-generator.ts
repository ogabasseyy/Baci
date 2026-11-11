import {
  generateReceiptHtml,
  type ReceiptMerchant,
  type ReceiptOptions,
  type ReceiptOrder,
} from '@baci/shared';
import { renderHtmlToPdf } from '@/lib/receipt-html-to-pdf';
import { validateReceiptLogoDataUri } from '@/lib/receipt-logo';

export { resolveReceiptLogoDataUri } from '@/lib/receipt-logo';

interface GenerateReceiptPdfOptions {
  buyerReference?: string | null;
  complianceNote?: string;
  documentDate?: Date | string | null;
  documentKind?: 'invoice' | 'proforma_invoice' | 'receipt';
  invoiceTypeCode?: string | null;
  dueDate?: Date | string | null;
  firsCsid?: string | null;
  firsIrn?: string | null;
  invoiceNotes?: string | null;
  renderDeadline?: number;
  logoDataUri?: string | null;
  paymentTerms?: string | null;
  taxSubtotals?: ReceiptOrder['tax_subtotals'];
}

function toDateString(value: Date | string | null | undefined) {
  if (!value) return undefined;
  const timestamp =
    typeof value === 'string' ? Date.parse(value) : value.getTime();
  if (!Number.isFinite(timestamp)) return undefined;
  const iso = new Date(timestamp).toISOString();
  if (typeof value !== 'string') return iso;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && !iso.startsWith(value))
    return undefined;
  return value;
}

/** Export the admin document. This adapter supplies data, never a second PDF layout. */
export async function generateReceiptBlob(
  order: ReceiptOrder,
  merchant: ReceiptMerchant,
  options: GenerateReceiptPdfOptions = {}
): Promise<Blob> {
  const kind =
    options.documentKind === 'proforma_invoice'
      ? 'proforma'
      : options.documentKind;
  const date = toDateString(options.documentDate);
  const issueDate =
    kind === 'receipt'
      ? null
      : (toDateString(order.invoice_issue_date)?.slice(0, 10) ??
        (date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null));
  const documentOrder: ReceiptOrder = {
    ...order,
    payment_status:
      kind === 'receipt' &&
      order.balance <= 0 &&
      order.amount_paid >= order.total
        ? 'paid'
        : order.payment_status.trim().toLowerCase(),
    transaction_date:
      date ??
      toDateString(order.transaction_date) ??
      toDateString(order.created_at),
    invoice_issue_date: issueDate,
    buyer_reference: options.buyerReference ?? order.buyer_reference,
    payment_due_date: toDateString(options.dueDate) ?? order.payment_due_date,
    firs_irn: options.firsIrn ?? order.firs_irn,
    firs_csid: options.firsCsid ?? order.firs_csid,
    invoice_note: options.invoiceNotes ?? order.invoice_note,
    payment_terms: options.paymentTerms ?? order.payment_terms,
    tax_subtotals: options.taxSubtotals ?? order.tax_subtotals,
  };
  const documentOptions: ReceiptOptions = {
    documentKind: kind,
    invoiceTypeCode: options.invoiceTypeCode,
    complianceNote: options.complianceNote,
  };
  // Only capped, allowlisted logo bytes may reach the isolated browser.
  const html = generateReceiptHtml(
    documentOrder,
    {
      ...merchant,
      logo_url: await validateReceiptLogoDataUri(options.logoDataUri),
    },
    documentOptions
  );
  const pdf = await (options.renderDeadline === undefined
    ? renderHtmlToPdf(html)
    : renderHtmlToPdf(html, options.renderDeadline));
  return new Blob([new Uint8Array(pdf)], { type: 'application/pdf' });
}

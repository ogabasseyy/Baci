import {
  generateReceiptHtml,
  type ReceiptMerchant,
  type ReceiptOptions,
  type ReceiptOrder,
} from '@baci/shared';
import { renderHtmlToPdf } from '@/lib/receipt-html-to-pdf';

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
  logoDataUri?: string | null;
  paymentTerms?: string | null;
  taxSubtotals?: ReceiptOrder['tax_subtotals'];
}

function toDateString(value: Date | string | null | undefined) {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
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
  const isInvoice = kind === 'invoice' || kind === 'proforma';
  const documentOrder: ReceiptOrder = {
    ...order,
    payment_status:
      kind === 'receipt' &&
      order.balance <= 0 &&
      order.amount_paid >= order.total
        ? 'paid'
        : order.payment_status,
    transaction_date: date ?? order.transaction_date,
    invoice_issue_date: date
      ? isInvoice
        ? date.slice(0, 10)
        : null
      : order.invoice_issue_date,
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
      logo_url:
        options.logoDataUri &&
        /^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(options.logoDataUri)
          ? options.logoDataUri
          : null,
    },
    documentOptions
  );
  const pdf = await renderHtmlToPdf(html);
  return new Blob([new Uint8Array(pdf)], { type: 'application/pdf' });
}

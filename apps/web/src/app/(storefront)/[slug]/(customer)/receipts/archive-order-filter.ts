import { normalizeShippingStatus } from '@/lib/storefront-account-document-eligibility';
import type { StorefrontOrder } from '@/types/storefront-order';

const ARCHIVE_STATUSES = new Set(['shipped', 'delivered']);

/**
 * Archive-list predicate for customer receipts. Manual orders surface here
 * as soon as the orders API reports an emailable document for them, even
 * when they never shipped.
 */
export function isArchiveOrder(order: StorefrontOrder): boolean {
  // Manual orders live or die by the availability gate: an invalid manual
  // order (failed content validity, cancelled, unknown status) must fail
  // closed here instead of slipping through the legacy branches below and
  // advertising a download the document routes cannot serve.
  if (order.is_manual_order) {
    return (
      Boolean(order.receipt_eligible) ||
      Boolean(order.manual_document_available)
    );
  }
  // manual_document_available is intentionally absent here: the API only
  // sets it for manual orders (handled above). A stray flag on a
  // non-manual row is inconsistent producer data, but it grants nothing —
  // the legacy branches below never read it — so the row still falls
  // through: hiding it would conceal a receipt the download route (which
  // gates only on receipt_eligible) can serve.
  // The payment-method column is not constrained to lowercase (legacy
  // spellings exist), so normalize exactly like shipping status: an
  // 'Invoice' order still serves an invoice download from the archive.
  return (
    Boolean(order.receipt_eligible) ||
    ARCHIVE_STATUSES.has(normalizeShippingStatus(order.shipping_status)) ||
    normalizeShippingStatus(order.payment_method) === 'invoice' ||
    normalizeShippingStatus(order.paymentMethod) === 'invoice'
  );
}

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
  return (
    Boolean(order.receipt_eligible) ||
    Boolean(order.manual_document_available) ||
    ARCHIVE_STATUSES.has(normalizeShippingStatus(order.shipping_status)) ||
    order.payment_method === 'invoice' ||
    order.paymentMethod === 'invoice'
  );
}

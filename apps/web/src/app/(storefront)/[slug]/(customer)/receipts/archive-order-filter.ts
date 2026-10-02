import { normalizeShippingStatus } from '@/lib/storefront-account-document-eligibility';
import type { StorefrontOrder } from '@/types/storefront-order';

const ARCHIVE_STATUSES = new Set(['shipped', 'delivered']);

/**
 * Archive-list predicate for customer receipts. Manual orders surface here
 * as soon as the orders API reports an emailable document for them, even
 * when they never shipped.
 */
export function isArchiveOrder(order: StorefrontOrder): boolean {
  return (
    Boolean(order.receipt_eligible) ||
    Boolean(order.manual_document_available) ||
    ARCHIVE_STATUSES.has(normalizeShippingStatus(order.shipping_status)) ||
    order.payment_method === 'invoice' ||
    order.paymentMethod === 'invoice'
  );
}

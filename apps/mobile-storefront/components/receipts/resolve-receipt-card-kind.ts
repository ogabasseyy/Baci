import { isManualOrderRecord } from '@baci/shared/receipt';
import { isPromotedManualReceipt } from '@/hooks/receipt-promotion-gates';
import type { ReceiptListItem } from '@/types/receipt';

// Fail closed on stale kinds: the receipts list computes document_kind
// through the promotion gate, but a cached entry can outlive a terminal
// shipping flip — re-verify manual receipts through the same gate so a
// cancelled row never badges Receipt/View Receipt. Non-manual rows keep
// the list kind (the paid shortcut owns them, not this gate). The check
// is intentionally demote-only: a stale cached invoice stays an invoice
// until the list refetches — promoting it here would badge money
// received on data the promotion inputs have not re-validated.
// List-depth boundary: the list payload carries no per-transaction
// payments array, so transaction-level settled validity stays with the
// detail loader (which gates the preview on detail transactions); the
// card enforces every settled signal the list carries (payable status,
// settled total-vs-paid balance, non-terminal shipping).
export function resolveReceiptCardKind(
  item: ReceiptListItem
): ReceiptListItem['document_kind'] {
  if (
    item.document_kind === 'receipt' &&
    isManualOrderRecord({
      recordedByUserId: item.recorded_by_user_id,
      importJobId: item.import_job_id,
      externalSource: item.external_source,
    }) &&
    !isPromotedManualReceipt({
      recordedByUserId: item.recorded_by_user_id,
      importJobId: item.import_job_id,
      externalSource: item.external_source,
      paymentStatus: item.payment_status,
      shippingStatus: item.shipping_status,
      total: item.total,
      subtotal: item.subtotal,
      shippingFee: item.shipping_fee,
      taxAmount: item.tax_amount,
      discountAmount: item.discount_amount,
      amountPaid: item.amount_paid,
      currency: item.currency,
      items: item.items,
    })
  ) {
    return 'invoice';
  }
  return item.document_kind;
}

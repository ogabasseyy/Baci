import {
  isManualOrderRecord,
  isSettledManualBalance,
} from '@baci/shared/receipt';

// Narrow view of a receipt detail / order row for the manual promotion
// decision. Both the receipts-list fail-closed fetch and the receipt
// preview consume this single predicate, so a row that previews as an
// invoice can never hard-fail detail load like a paid order — and a row
// that previews as a receipt always fails closed on transaction errors
// instead of rendering misdated.
export interface ManualReceiptPromotionInput {
  recordedByUserId?: unknown;
  importJobId?: unknown;
  externalSource?: unknown;
  paymentStatus?: unknown;
  shippingStatus?: unknown;
  total?: unknown;
  subtotal?: unknown;
  shippingFee?: unknown;
  taxAmount?: unknown;
  discountAmount?: unknown;
  amountPaid?: unknown;
  currency?: unknown;
  items?: unknown;
}

const TERMINAL_SHIPPING_STATUSES = new Set([
  'cancelled',
  'canceled',
  'returned',
  'failed',
]);

const PROMOTABLE_PAYMENT_STATUSES = new Set([
  'paid',
  'unpaid',
  'pending',
  'partially_paid',
]);

function normalizeStatus(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/\s+/g, '_')
    : '';
}

// Web sender coercion: numeric strings count, null/NaN fail.
function isValidMoney(value: unknown): boolean {
  return (
    value !== null &&
    value !== undefined &&
    Number.isFinite(Number(value)) &&
    Number(value) >= 0
  );
}

function hasValidContent(input: ManualReceiptPromotionInput): boolean {
  const moneyValid = [
    input.total,
    input.subtotal,
    input.shippingFee,
    input.taxAmount,
    input.discountAmount,
    input.amountPaid,
  ].every(isValidMoney);
  if (!moneyValid) return false;
  if (
    input.currency != null &&
    (typeof input.currency !== 'string' ||
      !/^[A-Za-z]{3}$/.test(input.currency))
  ) {
    return false;
  }
  if (!Array.isArray(input.items) || input.items.length === 0) return false;
  return input.items.every((item) => {
    if (item == null || typeof item !== 'object') return false;
    const row = item as {
      product_name?: unknown;
      name?: unknown;
      price?: unknown;
      quantity?: unknown;
    };
    // Raw order rows carry name; mapped detail rows carry product_name.
    const label = row.product_name ?? row.name;
    return (
      typeof label === 'string' &&
      isValidMoney(row.price) &&
      row.quantity !== null &&
      row.quantity !== undefined &&
      Number.isFinite(Number(row.quantity)) &&
      Number(row.quantity) > 0
    );
  });
}

export function isPromotedManualReceipt(
  input: ManualReceiptPromotionInput
): boolean {
  if (
    !isManualOrderRecord({
      recordedByUserId: input.recordedByUserId,
      importJobId: input.importJobId,
      externalSource: input.externalSource,
    })
  ) {
    return false;
  }
  // Corrupt non-string statuses fail closed to invoice: '' normalizes to
  // non-terminal (would promote), but an unparseable row must never
  // render the money-received kind.
  if (
    (input.paymentStatus != null && typeof input.paymentStatus !== 'string') ||
    (input.shippingStatus != null && typeof input.shippingStatus !== 'string')
  ) {
    return false;
  }
  if (TERMINAL_SHIPPING_STATUSES.has(normalizeStatus(input.shippingStatus))) {
    return false;
  }
  if (!PROMOTABLE_PAYMENT_STATUSES.has(normalizeStatus(input.paymentStatus))) {
    return false;
  }
  if (
    !isSettledManualBalance({
      total: input.total as number | string | null | undefined,
      amountPaid: input.amountPaid as number | string | null | undefined,
    })
  ) {
    return false;
  }
  return hasValidContent(input);
}

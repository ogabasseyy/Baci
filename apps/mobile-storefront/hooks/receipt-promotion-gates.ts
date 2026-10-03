import {
  isDecimalMoney,
  isManualOrderRecord,
  isSettledManualBalance,
  MANUAL_ORDER_ITEM_FINANCIAL_FIELDS,
  type ManualOrderItemFinancialField,
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

// Genuine money only, shared with the settled-balance predicate: decimal
// numbers and canonical decimal strings count; hex, exponent, padded,
// boolean, and blank values fail closed to invoice instead of promoting.
function isValidMoney(value: unknown): boolean {
  return isDecimalMoney(value) && Number(value) >= 0;
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
    if (
      typeof label !== 'string' ||
      !isValidMoney(row.price) ||
      row.quantity === null ||
      row.quantity === undefined ||
      !Number.isFinite(Number(row.quantity)) ||
      Number(row.quantity) <= 0
    ) {
      return false;
    }
    // Sender-validated financial fields, from the shared gate list: absent
    // is fine (nullish in the sender schema), but a present value must be
    // genuine money exactly like the header totals — a negative extension,
    // fee, or VAT row renders as an invoice, never a promoted receipt, so
    // mobile cannot disagree with the emailed document.
    const financial = item as Partial<
      Record<ManualOrderItemFinancialField, unknown>
    >;
    return MANUAL_ORDER_ITEM_FINANCIAL_FIELDS.every((field) => {
      const value = financial[field];
      return value == null || isValidMoney(value);
    });
  });
}

// Everything promotion needs except the settled balance: the detail
// loader uses this to tell a deliverable manual invoice (history lookup
// failure is fatal, like the sender) from an invalid row rendering as an
// invoice (history lookup failure is tolerated so it can still open).
export function isPromotableManualDocument(
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
  return hasValidContent(input);
}

export function isPromotedManualReceipt(
  input: ManualReceiptPromotionInput
): boolean {
  return (
    isPromotableManualDocument(input) &&
    isSettledManualBalance({
      total: input.total as number | string | null | undefined,
      amountPaid: input.amountPaid as number | string | null | undefined,
    })
  );
}

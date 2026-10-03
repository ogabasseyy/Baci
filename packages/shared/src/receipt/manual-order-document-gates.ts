// Single source for the manual-order document gates every surface derives
// from: the sender schema, the web archive/download eligibility, and the
// mobile receipts list. Hand-mirroring these across web/mobile/SQL is what
// kept the review loop alive — a new validated item field lands here once
// and every gate picks it up. Text fields need no entry: both sides accept
// any string, so they cannot diverge.

export const MANUAL_ORDER_ITEM_FINANCIAL_FIELDS = [
  'assurance_fee',
  'line_extension_amount',
  'line_id',
  'vat_amount',
  'vat_rate',
] as const;

export type ManualOrderItemFinancialField =
  (typeof MANUAL_ORDER_ITEM_FINANCIAL_FIELDS)[number];

// Staff-recorded, never imported: a blank staff-entered source is absent,
// not imported, matching the enqueue trigger and sender truthiness.
export function isManualOrderRecord(input: {
  recordedByUserId?: string | null;
  importJobId?: string | null;
  externalSource?: string | null;
}): boolean {
  return (
    Boolean(input.recordedByUserId) &&
    !input.importJobId &&
    !input.externalSource?.trim()
  );
}

// A manual balance is settled when finite payments cover a non-negative
// total. Nulls fail closed (never coerced to zero through Number(null)),
// and a negative total is data corruption, never a covered receipt.
export function isSettledManualBalance(input: {
  total?: number | string | null;
  amountPaid?: number | string | null;
}): boolean {
  if (input.total == null || input.amountPaid == null) return false;
  const total = Number(input.total);
  const amountPaid = Number(input.amountPaid);
  return (
    Number.isFinite(total) &&
    total >= 0 &&
    Number.isFinite(amountPaid) &&
    amountPaid >= total
  );
}

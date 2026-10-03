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

// Blank without dereference: nullish or whitespace-only strings are
// absent; a present-but-malformed (non-string) marker disqualifies manual
// status instead of throwing on .trim(). Detail fetches only warn on
// schema failure, so a numeric marker can reach this predicate at runtime.
function isBlankProvenance(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '')
  );
}

// Staff-recorded, never imported: matches the enqueue trigger and sender
// truthiness for well-typed rows, and fails corrupt rows closed.
export function isManualOrderRecord(input: {
  recordedByUserId?: unknown;
  importJobId?: unknown;
  externalSource?: unknown;
}): boolean {
  return Boolean(
    input.recordedByUserId &&
      isBlankProvenance(input.importJobId) &&
      isBlankProvenance(input.externalSource)
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

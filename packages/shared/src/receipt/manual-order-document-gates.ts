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

// Decimal money only: plain numbers and canonical decimal strings count.
// Hex, exponent, and whitespace-padded strings coerce through Number()
// ('0x10' -> 16, '1e3' -> 1000, ' 100' -> 100) but money columns never
// produce them, so a row carrying them fails closed instead of settling
// or promoting. Sign-agnostic: callers apply their own >= 0.
const DECIMAL_MONEY_PATTERN = /^-?\d+(\.\d+)?$/;

export function isDecimalMoney(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' && DECIMAL_MONEY_PATTERN.test(value);
}

// Rendered money: present, decimal, finite, and non-negative. Nullish
// and blank amounts fail closed (never coerced to a valid zero), and
// non-decimal numeric strings fail like everywhere else money is read.
// The sender, the web eligibility gate, and the mobile promotion gate
// share this so a corrupt amount hides the document on every surface
// instead of sending on web while demoting on mobile.
export function isNonNegativeMoney(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  if (!isDecimalMoney(value)) return false;
  return Number(value) >= 0;
}

// A manual balance is settled when finite payments cover a non-negative
// total. Nulls fail closed (never coerced to zero through Number(null)),
// and a negative total is data corruption, never a covered receipt.
// Booleans, blank strings, and non-decimal numeric strings likewise fail
// closed through isDecimalMoney — like the mobile gate, which shares it.
export function isSettledManualBalance(input: {
  total?: number | string | null;
  amountPaid?: number | string | null;
}): boolean {
  if (input.total == null || input.amountPaid == null) return false;
  if (!isDecimalMoney(input.total) || !isDecimalMoney(input.amountPaid)) {
    return false;
  }
  const total = Number(input.total);
  const amountPaid = Number(input.amountPaid);
  return total >= 0 && amountPaid >= total;
}

import {
  isDecimalMoney,
  MANUAL_ORDER_ITEM_FINANCIAL_FIELDS,
} from '@baci/shared/receipt';

// PostgREST numeric columns arrive as decimal strings while the detail
// schema gates numbers: every rendered money field coerces before
// validation or valid orders fail closed and previews never open.
// Integers (quantity, line_id) arrive as JSON numbers and stay out.
export const DETAIL_HEADER_MONEY_FIELDS = [
  'total',
  'subtotal',
  'shipping_fee',
  'discount_amount',
  'tax_amount',
  'amount_paid',
] as const;

export const DETAIL_ITEM_MONEY_FIELDS = [
  'price',
  ...MANUAL_ORDER_ITEM_FINANCIAL_FIELDS,
] as const;

// Strict like the gates: genuine decimal strings coerce; blanks,
// booleans, and garbage become NaN so the schema still fails corrupt
// money closed instead of masking it (Number('') is 0, Number(true)
// is 1 — both would pass as valid money). Numbers pass through.
export function receiptMoneyOverrides(
  row: unknown,
  fields: readonly string[]
): Record<string, number> {
  const raw = row as Record<string, unknown> | null | undefined;
  const overrides: Record<string, number> = {};
  if (raw == null || typeof raw !== 'object') {
    return overrides;
  }
  for (const field of fields) {
    const value = raw[field];
    if (value == null || typeof value === 'number') {
      continue;
    }
    overrides[field] =
      typeof value === 'string' && isDecimalMoney(value)
        ? Number(value)
        : Number.NaN;
  }
  return overrides;
}

/** Error codes shared by cart consumers; transport denials remain distinct. */
export const CART_ERROR_CODES = [
  'unauthorized',
  'forbidden',
  'merchant_unavailable',
  'not_found',
  'expired',
  'version_conflict',
  'idempotency_conflict',
  'invalid_item',
  'cart_locked',
  'refresh_required',
  'temporarily_unavailable',
  'rate_limited',
  'merge_conflict',
  'too_many_lines',
  'handoff_consumed',
] as const;
export type CartErrorCode = (typeof CART_ERROR_CODES)[number];
export function isCartErrorCode(value: unknown): value is CartErrorCode {
  return (
    typeof value === 'string' && CART_ERROR_CODES.some((code) => code === value)
  );
}

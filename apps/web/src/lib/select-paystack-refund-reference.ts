// The reference shape the reference-path refund reconciler consumes. A
// reference outside this shape is silently unusable downstream, so both the
// webhook schema and the handler's nested-before-flat selection must agree
// on it: the schema rejects events with no usable identifier, and the
// handler must never prefer an unusable nested value over a usable flat one.
const USABLE_REFERENCE = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * Select the payment reference a refund event reconciles by: the nested
 * transaction reference when usable, otherwise the flat compatibility
 * field, otherwise undefined.
 */
export function selectPaystackRefundReference(
  nested: unknown,
  flat: unknown
): string | undefined {
  if (typeof nested === 'string' && USABLE_REFERENCE.test(nested)) {
    return nested;
  }
  if (typeof flat === 'string' && USABLE_REFERENCE.test(flat)) {
    return flat;
  }
  return undefined;
}

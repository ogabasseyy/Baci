// The reference shape the reference-path refund reconciler consumes: the
// full Paystack-allowed alphabet (alphanumerics plus `-`, `.`, `=` and
// `_`). A reference outside this shape is silently unusable downstream, so
// the webhook schema, the handler's nested-before-flat selection, and the
// recovery verification path must agree on it: the schema rejects events
// with no usable identifier, and the handler must never prefer an unusable
// nested value over a usable flat one.
const USABLE_REFERENCE = /^[A-Za-z0-9.=_-]{1,100}$/;

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

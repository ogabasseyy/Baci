import {
  NON_VEND_PARENT,
  NON_VEND_STATUS_PREFIX,
} from './monnify-structured-outcome';

const MAX_DEPTH = 6;

/**
 * Every string value in a parsed Monnify answer (any depth), joined by a
 * space. Keys are left out, so text checks read only what Monnify wrote and
 * a key such as "reference" echoing our own request never matches as text.
 */
export function joinMonnifyAnswerStrings(
  value: unknown,
  depth = 0,
  underNonVend = false
): string {
  if (typeof value === 'string') {
    return value;
  }
  if (depth > MAX_DEPTH || !value || typeof value !== 'object') {
    return '';
  }
  const entries: [string, unknown][] = Array.isArray(value)
    ? value.map((item) => ['', item])
    : Object.entries(value);
  return entries
    .filter(([key]) => {
      const normalised = key.replace(/[\s_-]/g, '').toLowerCase();
      // A status value under another object (customerStatus, or any status
      // beneath refund/request/...) is that object's state, not vend wording.
      return !(
        normalised.endsWith('status') &&
        (underNonVend || NON_VEND_STATUS_PREFIX.test(normalised))
      );
    })
    .map(([key, child]) =>
      joinMonnifyAnswerStrings(
        child,
        depth + 1,
        underNonVend ||
          NON_VEND_PARENT.test(key.replace(/[\s_-]/g, '').toLowerCase())
      )
    )
    .filter(Boolean)
    .join(' ');
}

import { NON_VEND_STATUS_PREFIX } from './monnify-structured-outcome';

const MAX_DEPTH = 6;

/**
 * Every string value in a parsed Monnify answer (any depth), joined by a
 * space. Keys are left out, so text checks read only what Monnify wrote and
 * a key such as "reference" echoing our own request never matches as text.
 */
export function joinMonnifyAnswerStrings(value: unknown, depth = 0): string {
  if (typeof value === 'string') {
    return value;
  }
  if (depth > MAX_DEPTH || !value || typeof value !== 'object') {
    return '';
  }
  const children = Array.isArray(value)
    ? value
    : Object.entries(value)
        // A customerStatus / productStatus / refundStatus value is another
        // object's state, never wording about the vend.
        .filter(
          ([key]) =>
            !NON_VEND_STATUS_PREFIX.test(
              key.replace(/[\s_-]/g, '').toLowerCase()
            )
        )
        .map(([, child]) => child);
  return children
    .map((child) => joinMonnifyAnswerStrings(child, depth + 1))
    .filter(Boolean)
    .join(' ');
}

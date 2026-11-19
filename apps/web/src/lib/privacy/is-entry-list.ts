import type { PrivateEntry } from './sensitive-url-params';

/** Validates untrusted (storage) JSON as a list of name/value pairs. */
export function isEntryList(value: unknown): value is PrivateEntry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === 'string' &&
        typeof entry[1] === 'string'
    )
  );
}

import { z } from 'zod';

// biome-ignore lint/suspicious/noControlCharactersInRegex: Explicitly reject URL-normalizing control characters.
const controlOrBackslash = /[\\\u0000-\u001f\u007f-\u009f]/;
const encodedOctet = /%[\da-f]{2}/i;
const validationOrigin = 'https://portable-store.invalid';
const tenantPrefix = '/_baci_store';

/** Keep browser URL normalization and repeated path decoding inside the same store.
 * Query/fragment data is not decoded: a search value may legitimately contain a URL.
 */
function isSameStorePath(value: string): boolean {
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    controlOrBackslash.test(value)
  )
    return false;
  const path = value.split(/[?#]/, 1)[0];
  for (const segment of path.split('/')) {
    let current = segment;
    // Each successful decoding shortens the bounded input, so this also bounds work.
    while (true) {
      if (
        current === '.' ||
        current === '..' ||
        current.includes('/') ||
        controlOrBackslash.test(current)
      )
        return false;
      if (!encodedOctet.test(current)) break;
      let decoded: string;
      try {
        decoded = decodeURIComponent(current);
      } catch {
        return false;
      }
      if (decoded === current) break;
      current = decoded;
    }
  }
  try {
    // The '?' sentinel preserves trailing path whitespace for the comparison.
    const originalPath = new URL(`${validationOrigin}${path}?`).pathname;
    const root = new URL(value, validationOrigin);
    const scoped = new URL(`${tenantPrefix}${value}`, validationOrigin);
    return (
      root.origin === validationOrigin &&
      root.pathname === originalPath &&
      scoped.origin === validationOrigin &&
      scoped.pathname === `${tenantPrefix}${originalPath}`
    );
  } catch {
    return false;
  }
}

export const portableSameStorePathSchema = z
  .string()
  .max(500)
  .refine(
    isSameStorePath,
    'A same-store path without traversal or encoded separators is required'
  );

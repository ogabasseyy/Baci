/**
 * Pure helper for the builder's storefront-scoped routing logic.
 *
 * Extracted from `config.tsx` so the routing logic is unit-testable
 * independent of the multi-thousand-line builder config. The companion
 * React hook and link wrapper live in `storefront-scoping.tsx` to keep
 * the pure function importable without pulling in React.
 */
export function getStorefrontScopedHref(
  url: string,
  basePath?: string | null
): string {
  const trimmedUrl = url.trim();

  if (
    !trimmedUrl ||
    trimmedUrl.startsWith('#') ||
    /^[a-z][a-z\d+.-]*:/i.test(trimmedUrl) ||
    trimmedUrl.startsWith('//') ||
    !trimmedUrl.startsWith('/') ||
    !basePath
  ) {
    return trimmedUrl;
  }

  const normalizedBasePath = basePath === '/' ? '' : basePath;
  if (
    !normalizedBasePath ||
    trimmedUrl === normalizedBasePath ||
    trimmedUrl.startsWith(`${normalizedBasePath}/`) ||
    trimmedUrl.startsWith(`${normalizedBasePath}?`) ||
    trimmedUrl.startsWith(`${normalizedBasePath}#`)
  ) {
    return trimmedUrl;
  }

  return `${normalizedBasePath}${trimmedUrl === '/' ? '' : trimmedUrl}`;
}

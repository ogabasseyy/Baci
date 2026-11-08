export function normalizeStorefrontBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export function buildStorefrontEntityId(
  baseUrl: string,
  fragment: string
): string {
  const normalizedBase = normalizeStorefrontBaseUrl(baseUrl);
  const normalizedFragment = fragment.replace(/^#+/, '');
  return `${normalizedBase}/#${normalizedFragment}`;
}

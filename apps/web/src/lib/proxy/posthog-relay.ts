export const STATIC_ASSET_EXTENSION_REGEX =
  /\.(?:svg|png|jpg|jpeg|gif|webp|avif|woff|woff2|ttf|eot|css|js|json)$/i;

export const DEFAULT_POSTHOG_RELAY_PATH = '/baci-relay';

export const RESERVED_POSTHOG_RELAY_PATH_PREFIXES = [
  '/api',
  '/_next',
  '/admin',
  '/auth',
  '/builder',
  '/checkout',
  '/dashboard',
  '/login',
  '/logout',
  '/track',
] as const;

export const POSTHOG_RELAY_PATH = normalizePostHogRelayPath(
  process.env.NEXT_PUBLIC_POSTHOG_PROXY_PATH
);

export function normalizePostHogRelayPath(value?: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return DEFAULT_POSTHOG_RELAY_PATH;
  }
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const normalized =
    withLeadingSlash.replace(/\/+$/, '') || DEFAULT_POSTHOG_RELAY_PATH;
  return isReservedPostHogRelayPath(normalized)
    ? DEFAULT_POSTHOG_RELAY_PATH
    : normalized;
}

export function isReservedPostHogRelayPath(pathname: string): boolean {
  const normalized = pathname.toLowerCase();
  return RESERVED_POSTHOG_RELAY_PATH_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`)
  );
}

export function isPostHogRelayPath(pathname: string): boolean {
  return (
    pathname === POSTHOG_RELAY_PATH ||
    pathname.startsWith(`${POSTHOG_RELAY_PATH}/`)
  );
}

export function isStaticAssetOutsidePostHogRelay(pathname: string): boolean {
  return (
    /\/(?:static|array)\//.test(pathname) &&
    STATIC_ASSET_EXTENSION_REGEX.test(pathname) &&
    !isPostHogRelayPath(pathname)
  );
}

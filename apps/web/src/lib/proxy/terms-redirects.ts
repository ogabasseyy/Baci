import { type NextRequest, NextResponse } from 'next/server';

export const CANONICAL_STOREFRONT_TERMS_PATH = '/terms';

export const LEGACY_STOREFRONT_TERMS_ALIAS_PATHS = new Set([
  '/terms-and-conditions',
  '/terms-of-service',
]);

export function normalizeStorefrontTermsAliasPath(pathname: string): string {
  const lookupPathname =
    pathname.length > 1 && pathname.endsWith('/')
      ? pathname.slice(0, -1)
      : pathname;

  return LEGACY_STOREFRONT_TERMS_ALIAS_PATHS.has(lookupPathname.toLowerCase())
    ? CANONICAL_STOREFRONT_TERMS_PATH
    : pathname;
}

export function buildLegacyTermsAliasRedirectResponse(
  request: NextRequest,
  pathname: string,
  targetHostname?: string
): NextResponse | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return null;
  }

  const normalizedPathname = normalizeStorefrontTermsAliasPath(pathname);
  if (
    normalizedPathname === pathname ||
    normalizedPathname !== CANONICAL_STOREFRONT_TERMS_PATH
  ) {
    return null;
  }

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = normalizedPathname;

  if (targetHostname) {
    redirectUrl.protocol = 'https:';
    redirectUrl.hostname = targetHostname;
    redirectUrl.port = '';
  }

  return NextResponse.redirect(redirectUrl, 301);
}

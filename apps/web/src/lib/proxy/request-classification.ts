import type { NextRequest } from 'next/server';
import { getInternalApiSecret } from '@/lib/internal-api-secret';
import { hasValidInternalAuth } from '@/lib/internal-auth-header';
import {
  hasControlCharacter,
  PROTOCOL_SCHEME_REGEX,
} from '@/lib/proxy/path-normalization';

export function safeDecodeSegment(segment: string | undefined): string {
  if (!segment) {
    return '';
  }
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function isAuthenticatedInternalRequest(request: NextRequest): boolean {
  const secret = getInternalApiSecret();
  if (!secret) {
    return false;
  }
  return hasValidInternalAuth(request, secret);
}

export function isSupabaseAuthCookieName(cookieName: string): boolean {
  const normalizedName = cookieName.toLowerCase();
  return (
    normalizedName === 'supabase-auth-token' ||
    normalizedName.startsWith('supabase-auth-token.') ||
    (normalizedName.startsWith('sb-') && normalizedName.includes('auth-token'))
  );
}

export function hasStorefrontAuthSessionHint(
  request: NextRequest | undefined
): boolean {
  if (!request) {
    return true;
  }

  if (
    request.headers.has('x-supabase-auth-token') ||
    request.headers.has('authorization')
  ) {
    return true;
  }

  return request.cookies
    .getAll()
    .some(
      (cookie) =>
        cookie.value.length > 0 && isSupabaseAuthCookieName(cookie.name)
    );
}

export function sanitizeProxyRedirectPath(
  rawRedirect: string | null | undefined,
  defaultPath = '/dashboard'
): string {
  if (!rawRedirect) {
    return defaultPath;
  }

  if (
    !rawRedirect.startsWith('/') ||
    rawRedirect.startsWith('//') ||
    // Reject any backslash: the WHATWG URL parser normalizes `\` to `/` in
    // HTTPS-scheme contexts, so `/\evil.com` parses with host=evil.com. We
    // reject before the parse to avoid the authority-switch open-redirect.
    // Control characters are also rejected before URL parsing because the
    // parser strips them silently.
    rawRedirect.includes('\\') ||
    hasControlCharacter(rawRedirect) ||
    PROTOCOL_SCHEME_REGEX.test(rawRedirect)
  ) {
    return defaultPath;
  }

  try {
    const parsed = new URL(rawRedirect, 'https://usebaci.local');
    // Defense in depth: if the parser produced any host other than the
    // placeholder, the input contained an authority switch we didn't catch.
    if (parsed.host !== 'usebaci.local') {
      return defaultPath;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return defaultPath;
  }
}

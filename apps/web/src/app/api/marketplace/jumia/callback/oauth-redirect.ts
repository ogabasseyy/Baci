import { createJumiaMobileReturnUrl } from '@baci/shared';
import { type NextRequest, NextResponse } from 'next/server';
import { jumiaOAuthDiagnostic } from '@/lib/jumia/oauth-diagnostic';

const OAUTH_COOKIE_NAMES = [
  'jumia_oauth_state',
  'jumia_merchant_id',
  'jumia_oauth_platform',
  'jumia_ticket_id',
  'jumia_oauth_variant',
  jumiaOAuthDiagnostic.cookieName,
] as const;

function clear(response: NextResponse): NextResponse {
  for (const cookieName of OAUTH_COOKIE_NAMES) {
    response.cookies.delete(cookieName);
  }
  return response;
}

function create(
  request: NextRequest,
  query?: Record<string, string | undefined>
): NextResponse {
  const platform = request.cookies.get('jumia_oauth_platform')?.value;
  let response: NextResponse;

  if (platform === 'mobile') {
    // SAFE: this shared helper uses a hard-coded allow-listed deep-link scheme
    // and URL-encodes every query value.
    response = NextResponse.redirect(createJumiaMobileReturnUrl(query));
  } else {
    const redirectUrl = new URL('/dashboard/channels', request.url);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) {
        redirectUrl.searchParams.set(key, value);
      }
    }
    response = NextResponse.redirect(redirectUrl);
  }

  if (request.cookies.has(jumiaOAuthDiagnostic.cookieName)) {
    response.headers.set('Cache-Control', 'private, no-store');
    return clear(response);
  }

  return response;
}

export const jumiaOAuthCallbackRedirect = { clear, create };

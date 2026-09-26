import { NextRequest, NextResponse } from 'next/server';
import { generateCSP, generateCspNonce } from '@/lib/proxy/csp';
import { isLocalhost } from '@/lib/proxy/host';
import { sanitizeProxyRedirectPath } from '@/lib/proxy/request-classification';
import { applySecurityHeaders } from '@/lib/proxy/response-headers';
import { getRouteType } from '@/lib/proxy/routing-policy';
import { updateSession } from '@/lib/supabase/middleware';

export function isSessionRoutingEligible(pathname: string): boolean {
  return (
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/builder') ||
    pathname.startsWith('/admin') ||
    pathname === '/login' ||
    pathname === '/reset-password'
  );
}

function copySupabaseCookies(
  response: NextResponse,
  supabaseResponse: NextResponse
): NextResponse {
  for (const cookie of supabaseResponse.cookies.getAll()) {
    response.cookies.set(cookie);
  }
  return response;
}

export async function runSessionRoutingStage(
  request: NextRequest,
  pathname: string,
  hostname: string,
  userAgent: string
): Promise<NextResponse | null> {
  const isProtectedRoute =
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/builder') ||
    pathname.startsWith('/admin');
  const isAuthRoute = pathname === '/login' || pathname === '/reset-password';
  if (!isProtectedRoute && !isAuthRoute) return null;

  const routeType = getRouteType(pathname);
  const isLocal = isLocalhost(hostname);
  const nonce = generateCspNonce();
  const csp = generateCSP(routeType, isLocal, nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const modifiedRequest = new NextRequest(request, { headers: requestHeaders });
  const initialResponse = NextResponse.next({
    request: { headers: requestHeaders },
  });
  const { supabaseResponse, user } = await updateSession(
    modifiedRequest,
    initialResponse
  );

  if (isProtectedRoute && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set(
      'redirect',
      `${pathname}${request.nextUrl.search}${request.nextUrl.hash}`
    );
    return applySecurityHeaders(
      copySupabaseCookies(NextResponse.redirect(url), supabaseResponse),
      pathname,
      userAgent,
      routeType,
      isLocal,
      nonce,
      undefined,
      hostname
    );
  }
  if (isAuthRoute && user) {
    const redirectTo = sanitizeProxyRedirectPath(
      request.nextUrl.searchParams.get('redirect') ??
        request.nextUrl.searchParams.get('redirectTo')
    );
    const redirectUrl = new URL(redirectTo, request.nextUrl.origin);
    const url = request.nextUrl.clone();
    url.pathname = redirectUrl.pathname;
    url.search = redirectUrl.search;
    url.hash = redirectUrl.hash;
    return applySecurityHeaders(
      copySupabaseCookies(NextResponse.redirect(url), supabaseResponse),
      pathname,
      userAgent,
      routeType,
      isLocal,
      nonce,
      undefined,
      hostname
    );
  }
  return applySecurityHeaders(
    supabaseResponse,
    pathname,
    userAgent,
    routeType,
    isLocal,
    nonce,
    undefined,
    hostname
  );
}

import { type CookieOptions, createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/env';
import { isLocalhost } from './host';
import { verifyOxygenDocumentOwnership } from './oxygen-document-ownership';
import {
  isOxygenPaymentSurface,
  isStorefrontCheckoutPath,
} from './oxygen-payment-surface';
import { applySecurityHeaders } from './response-headers';

const refreshMarker = '__oxygen_policy_refresh';

/** Run only with the merchant slug established by the trusted routing stage. */
export async function applyOwnedOxygenDocumentPolicy(
  response: NextResponse,
  request: NextRequest,
  pathname: string,
  hostname: string,
  userAgent: string,
  trustedMerchantSlug: string | null
): Promise<NextResponse> {
  if (
    request.method !== 'GET' ||
    !isStorefrontCheckoutPath(pathname) ||
    !isOxygenPaymentSurface(pathname, request.nextUrl.searchParams) ||
    response.status >= 300 ||
    !trustedMerchantSlug
  )
    return response;
  // Never cache a response whose policy depends on session and ownership.
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('CDN-Cache-Control', 'no-store');
  response.headers.set('Vercel-CDN-Cache-Control', 'no-store');
  const orderId = request.nextUrl.searchParams.get('oxygenOrderId');
  if (!orderId) return response;
  const rotated: { name: string; value: string; options: CookieOptions }[] = [];
  try {
    const client = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (values) => {
          rotated.push(...values);
        },
      },
    });
    const owned = await verifyOxygenDocumentOwnership(
      client,
      orderId,
      trustedMerchantSlug
    );
    if (rotated.length) {
      const marker = request.nextUrl.searchParams.get(refreshMarker) ?? '';
      const match = /^(\d{13})(?:-(\d))?$/.exec(marker);
      const startedAt = Number(match?.[1]);
      const recent = startedAt > 0 && Math.abs(Date.now() - startedAt) < 30_000;
      // Accept the old timestamp-only marker as one completed redirect.
      const attempts = recent ? Number(match?.[2] ?? '1') : 0;
      if (attempts >= 3) {
        // Do not render checkout against stale request cookies. A retry will
        // carry the rotated cookies without allowing an unbounded redirect loop.
        const retry = new NextResponse('Session refreshed. Please retry.', {
          status: 503,
          headers: {
            'Cache-Control': 'private, no-store',
            'CDN-Cache-Control': 'no-store',
            'Vercel-CDN-Cache-Control': 'no-store',
            'Retry-After': '1',
          },
        });
        for (const cookie of response.cookies.getAll())
          retry.cookies.set(cookie);
        for (const { name, value, options } of rotated)
          retry.cookies.set(name, value, options);
        return retry;
      }
      // Avoid duplicating large refreshed cookies in a rewrite response.
      const target = request.nextUrl.clone();
      target.searchParams.set(
        refreshMarker,
        `${recent ? startedAt : Date.now()}-${attempts + 1}`
      );
      const redirect = NextResponse.redirect(target, 307);
      redirect.headers.set('Cache-Control', 'private, no-store');
      redirect.headers.set('CDN-Cache-Control', 'no-store');
      redirect.headers.set('Vercel-CDN-Cache-Control', 'no-store');
      for (const cookie of response.cookies.getAll())
        redirect.cookies.set(cookie);
      for (const { name, value, options } of rotated)
        redirect.cookies.set(name, value, options);
      return redirect;
    }
    if (owned)
      applySecurityHeaders(
        response,
        pathname,
        userAgent,
        'storefront',
        isLocalhost(hostname),
        undefined,
        request,
        hostname,
        true
      );
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('CDN-Cache-Control', 'no-store');
    response.headers.set('Vercel-CDN-Cache-Control', 'no-store');
  } catch {
    // Authentication, lookup, or configuration failure never widens policy.
  }
  return response;
}

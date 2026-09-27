import { type NextRequest, NextResponse } from 'next/server';
import { buildProxyRequestHeaders } from './request-headers';

export function generateCSP(
  routeType: 'admin' | 'auth' | 'storefront' | 'api',
  isLocal: boolean,
  nonce?: string
): string {
  const storefrontUnsafeEval = isLocal ? " 'unsafe-eval'" : '';
  const strictScriptSource = nonce
    ? `'self' 'nonce-${nonce}'`
    : "'self' 'unsafe-inline'";
  const baseDirectives = {
    'default-src': "'self'",
    'img-src': "'self' blob: data: https:",
    'font-src': "'self' data: https://fonts.gstatic.com",
    'media-src': "'self' https:",
    'object-src': "'none'",
    'base-uri': "'self'",
    'frame-ancestors': "'self'",
    ...(isLocal ? {} : { 'upgrade-insecure-requests': '' }),
  };

  const directives =
    routeType === 'admin' || routeType === 'auth'
      ? {
          ...baseDirectives,
          // Next reads the forwarded request CSP and applies this nonce to its
          // framework and Flight script tags before rendering admin/auth pages.
          'script-src': `${strictScriptSource}${isLocal ? " 'unsafe-eval'" : ''} https://vercel.live https://va.vercel-scripts.com`,
          'script-src-attr': "'none'",
          'style-src': "'self' 'unsafe-inline' https://fonts.googleapis.com",
          'connect-src':
            "'self' https://*.supabase.co wss://*.supabase.co https://api.korapay.com https://generativelanguage.googleapis.com https://vercel.live https://vitals.vercel-insights.com https://helpdesk.usebaci.com",
          'frame-src': "'self' https://checkout.korapay.com",
          'form-action': "'self'",
        }
      : routeType === 'storefront'
        ? {
            ...baseDirectives,
            'script-src': `'self' 'unsafe-inline'${storefrontUnsafeEval} https://vercel.live https://va.vercel-scripts.com https://static.cloudflareinsights.com https://*.myhuaweicloud.com https://js.useklump.com https://asset.useklump.com https://checkout.useklump.com https://checkout-v2.useklump.com https://directdebit.useklump.com https://checkout.credpal.com https://checkout.creditdirect.ng https://app.creditdirect.ng https://cdl.test.lendastack.io https://securepubads.g.doubleclick.net https://www.googletagservices.com https://pagead2.googlesyndication.com https://www.google.com https://www.gstatic.com https://googleads.g.doubleclick.net https://td.doubleclick.net https://ad.doubleclick.net https://pubads.g.doubleclick.net https://tpc.googlesyndication.com https://cdn.ampproject.org https://*.adtrafficquality.google https://cm.g.doubleclick.net`,
            'style-src': "'self' 'unsafe-inline' https://fonts.googleapis.com",
            'connect-src':
              "'self' https://*.supabase.co https://vitals.vercel-insights.com https://cloudflareinsights.com https://checkout.useklump.com https://checkout-v2.useklump.com https://directdebit.useklump.com https://checkout.credpal.com https://api.credpal.com https://checkout.creditdirect.ng https://app.creditdirect.ng https://cdl.test.lendastack.io https://securepubads.g.doubleclick.net https://pagead2.googlesyndication.com https://*.adtrafficquality.google https://www.google.com https://googleads.g.doubleclick.net https://pubads.g.doubleclick.net https://cdn.ampproject.org https://cm.g.doubleclick.net",
            'frame-src':
              "'self' https://asset.useklump.com https://checkout.useklump.com https://checkout-v2.useklump.com https://directdebit.useklump.com https://checkout.credpal.com https://checkout.creditdirect.ng https://app.creditdirect.ng https://cdl.test.lendastack.io https://googleads.g.doubleclick.net https://*.safeframe.googlesyndication.com https://tpc.googlesyndication.com https://td.doubleclick.net https://www.google.com https://cdn.ampproject.org https://*.adtrafficquality.google https://ep2.adtrafficquality.google https://cm.g.doubleclick.net https://securepubads.g.doubleclick.net",
          }
        : {
            'default-src': "'self'",
            'object-src': "'none'",
            'frame-ancestors': "'none'", // APIs usually don't need to be framed
          };

  return Object.entries(directives)
    .map(([key, value]) => (value ? `${key} ${value}` : key).trim())
    .join('; ');
}

export function generateCspNonce(): string {
  try {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return encodeCspNonce(String.fromCharCode(...bytes));
  } catch {
    return encodeCspNonce(crypto.randomUUID());
  }
}

export function encodeCspNonce(value: string): string {
  return btoa(value)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

export function shouldForwardStrictCspNonce(
  routeType: 'admin' | 'auth' | 'storefront' | 'api'
): routeType is 'admin' | 'auth' {
  return routeType === 'admin' || routeType === 'auth';
}

export function buildStrictCspResponse(
  request: NextRequest,
  routeType: 'admin' | 'auth',
  isLocal: boolean
): { nonce: string; response: NextResponse } {
  const nonce = generateCspNonce();
  const csp = generateCSP(routeType, isLocal, nonce);
  const requestHeaders = buildProxyRequestHeaders(request);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  return {
    nonce,
    response: NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    }),
  };
}

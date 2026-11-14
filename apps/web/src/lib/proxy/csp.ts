import { type NextRequest, NextResponse } from 'next/server';
import { readOxygenHostedOrigins } from '@/lib/payments/oxygen/oxygen-hosted-origins';
import { getExperienceExecutionOrigin } from '../experience/execution-origin-runtime';
import { isOxygenPaymentSurface } from './oxygen-payment-surface';
import { buildProxyRequestHeaders } from './request-headers';

export function generateCSP(
  routeType: 'admin' | 'auth' | 'storefront' | 'api',
  isLocal: boolean,
  nonce?: string,
  pathname?: string,
  searchParams?: URLSearchParams,
  oxygenOwned = false
): string {
  const chatwootOrigin = getEnabledChatwootPlatformOrigin();
  const hostedOrigins =
    oxygenOwned &&
    routeType === 'storefront' &&
    isOxygenPaymentSurface(pathname ?? '', searchParams)
      ? readOxygenHostedOrigins().hosted
      : [];
  const executionOrigin = getExperienceExecutionOrigin();
  const builderExperiencePreview = isExperienceBuilderPreviewPath(
    pathname ?? ''
  );
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

  // Exact browser SDK/collector origins; account configuration and consent still
  // control whether any provider is loaded. Keep these out of admin/auth CSP.
  const socialScripts =
    'https://connect.facebook.net https://analytics.tiktok.com https://sc-static.net https://tr.snapchat.com https://static.ads-twitter.com';
  const socialCollectors =
    'https://www.facebook.com https://analytics.tiktok.com https://tr.snapchat.com https://tr6.snapchat.com https://analytics.twitter.com https://analytics.x.com https://t.co';

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
            'script-src': `'self' 'unsafe-inline'${storefrontUnsafeEval} ${socialScripts} https://bzrcdn.openai.com https://vercel.live https://va.vercel-scripts.com https://static.cloudflareinsights.com https://*.myhuaweicloud.com https://js.useklump.com https://asset.useklump.com https://checkout.useklump.com https://checkout-v2.useklump.com https://directdebit.useklump.com https://checkout.creditdirect.ng https://app.creditdirect.ng https://cdl.test.lendastack.io https://securepubads.g.doubleclick.net https://www.googletagservices.com https://pagead2.googlesyndication.com https://www.google.com https://www.gstatic.com https://googleads.g.doubleclick.net https://td.doubleclick.net https://ad.doubleclick.net https://pubads.g.doubleclick.net https://tpc.googlesyndication.com https://cdn.ampproject.org https://*.adtrafficquality.google https://cm.g.doubleclick.net${chatwootOrigin ? ` ${chatwootOrigin}` : ''}`,
            'style-src': "'self' 'unsafe-inline' https://fonts.googleapis.com",
            // wss://*.supabase.co: the shared cart's private Realtime channel.
            // An https: source does not cover wss:, so without it browsers
            // block the socket and shoppers never get cart-change notices.
            'connect-src': `'self' ${socialCollectors} https://*.supabase.co wss://*.supabase.co https://vitals.vercel-insights.com https://cloudflareinsights.com https://bzr.openai.com https://bzrcdn.openai.com https://checkout.useklump.com https://checkout-v2.useklump.com https://directdebit.useklump.com https://checkout.creditdirect.ng https://app.creditdirect.ng https://cdl.test.lendastack.io https://securepubads.g.doubleclick.net https://pagead2.googlesyndication.com https://*.adtrafficquality.google https://www.google.com https://googleads.g.doubleclick.net https://pubads.g.doubleclick.net https://cdn.ampproject.org https://cm.g.doubleclick.net`,
            'frame-src': `'self'${hostedOrigins.map((origin) => ` ${origin}`).join('')} https://payment.hydrogenpay.com https://asset.useklump.com https://checkout.useklump.com https://checkout-v2.useklump.com https://directdebit.useklump.com https://checkout.creditdirect.ng https://app.creditdirect.ng https://cdl.test.lendastack.io https://googleads.g.doubleclick.net https://*.safeframe.googlesyndication.com https://tpc.googlesyndication.com https://td.doubleclick.net https://www.google.com https://cdn.ampproject.org https://*.adtrafficquality.google https://ep2.adtrafficquality.google https://cm.g.doubleclick.net https://securepubads.g.doubleclick.net`,
          }
        : {
            'default-src': "'self'",
            'object-src': "'none'",
            'frame-ancestors': "'none'", // APIs usually don't need to be framed
          };

  return Object.entries(directives)
    .map(([key, value]) => {
      const source =
        key === 'frame-src' &&
        executionOrigin &&
        (routeType === 'storefront' ||
          (routeType === 'admin' && builderExperiencePreview))
          ? `${value} ${executionOrigin}`
          : value;
      const withChatwoot =
        routeType === 'storefront' &&
        chatwootOrigin &&
        (key === 'connect-src' || key === 'frame-src')
          ? `${source} ${chatwootOrigin}`
          : source;
      return (withChatwoot ? `${key} ${withChatwoot}` : key).trim();
    })
    .join('; ');
}

/** Exact HTTPS origin only; malformed environment values never widen CSP. */
function getEnabledChatwootPlatformOrigin(): string | null {
  if (
    process.env.EKAETTE_CHATWOOT_WIDGET_ENABLED !== 'true' ||
    process.env.EKAETTE_CHATWOOT_CONTEXT_ENABLED !== 'true'
  ) {
    return null;
  }
  const value = process.env.EKAETTE_CHATWOOT_PLATFORM_ORIGIN?.trim();
  if (!value || value.length > 512) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      !url.hostname ||
      url.username ||
      url.password ||
      (url.port && url.port !== '443') ||
      (url.pathname && url.pathname !== '/') ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return `https://${url.hostname.toLowerCase()}`;
  } catch {
    return null;
  }
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
  const csp = generateCSP(routeType, isLocal, nonce, request.nextUrl.pathname);
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

export function isExperienceBuilderPreviewPath(pathname: string) {
  return (
    pathname === '/builder/experience' ||
    pathname.startsWith('/builder/experience/')
  );
}

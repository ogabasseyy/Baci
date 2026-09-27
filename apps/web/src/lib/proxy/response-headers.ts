import type { NextRequest, NextResponse } from 'next/server';
import {
  buildStorefrontDocumentCacheHeaders,
  type StorefrontDocumentCacheKind,
} from '@/config/storefront-cdn-cache-control';
import { selectStorefrontDocumentCacheKind } from '@/config/storefront-document-cache-kind';
import { STOREFRONT_METADATA_CACHE_BUCKET_HEADER } from '@/config/storefront-metadata-cache-bots';
import { generateCSP } from '@/lib/proxy/csp';
import { isLocalhost } from '@/lib/proxy/host';
import {
  canUseLongDownstreamStorefrontCache,
  isCacheablePublicStorefrontDocument,
  isStorefrontPdpDocument,
  NON_CACHEABLE_STOREFRONT_HTML_CACHE_CONTROL,
  shouldSetStorefrontDocumentCacheControl,
} from '@/lib/proxy/public-cache-eligibility';
import {
  getStorefrontPublicationResponseCacheTag,
  getStorefrontPublicCachePolicy,
} from '@/lib/proxy/public-cache-policy';
import { hasStorefrontAuthSessionHint } from '@/lib/proxy/request-classification';
import { appendVaryHeader } from '@/lib/proxy/request-headers';
import {
  BOT_USER_AGENT_REGEX,
  IMAGE_FILES_REGEX,
} from '@/lib/proxy/routing-constants';
import { isStorefrontNestedListingPath } from '@/lib/proxy/routing-policy';

export function applyStorefrontDocumentCacheHeaders(
  response: NextResponse,
  kind: StorefrontDocumentCacheKind,
  publicationCacheTag: string | null
): void {
  const cacheHeaders = buildStorefrontDocumentCacheHeaders(kind);
  response.headers.set('Cache-Control', cacheHeaders.cacheControl);
  if (cacheHeaders.vercelCdnCacheControl) {
    response.headers.set(
      'Vercel-CDN-Cache-Control',
      cacheHeaders.vercelCdnCacheControl
    );
  } else {
    response.headers.delete('Vercel-CDN-Cache-Control');
  }
  if (cacheHeaders.cdnCacheControl) {
    response.headers.set('CDN-Cache-Control', cacheHeaders.cdnCacheControl);
  } else {
    response.headers.delete('CDN-Cache-Control');
  }
  if (kind !== 'non-cacheable' && publicationCacheTag) {
    response.headers.set('Vercel-Cache-Tag', publicationCacheTag);
  } else {
    response.headers.delete('Vercel-Cache-Tag');
  }
}

export function applySecurityHeaders(
  response: NextResponse,
  pathname: string,
  userAgent: string,
  routeType: 'admin' | 'auth' | 'storefront' | 'api',
  isLocal: boolean,
  nonce?: string,
  request?: NextRequest,
  hostname?: string
): NextResponse {
  // Apply Content Security Policy
  const csp = generateCSP(routeType, isLocal, nonce);
  response.headers.set('Content-Security-Policy', csp);

  // Add missing security headers
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Storefront checkout embeds the Credit Direct BNPL flow in an in-page iframe
  // (see CSP frame-src) that runs camera-based identity verification. A blanket
  // `camera=()` allowlist disables the camera for the page AND every nested
  // iframe, so getUserMedia is hard-blocked before the browser can prompt.
  //
  // Per the Permissions Policy spec, a cross-origin iframe only gets a feature
  // if the embedding document has it enabled for its OWN origin — i.e. `self`
  // MUST be in the allowlist, otherwise delegation to the listed origins fails.
  // So we grant `self` plus the Credit Direct verification origins (live + the
  // cdl.test.lendastack.io test host used when isLive=false, matching the CSP
  // frame-src allowlist).
  //
  // To avoid handing camera/mic to every storefront page (getRouteType() buckets
  // all marketing/product/category pages as "storefront"), this is scoped to
  // checkout paths only. Everywhere else stays fully disabled.
  const isCheckoutRoute =
    routeType === 'storefront' && /\/checkout(\/|$)/.test(pathname);
  const cameraAllowlist = isCheckoutRoute
    ? 'camera=(self "https://checkout.creditdirect.ng" "https://app.creditdirect.ng" "https://cdl.test.lendastack.io"), microphone=(self "https://checkout.creditdirect.ng" "https://app.creditdirect.ng" "https://cdl.test.lendastack.io")'
    : 'camera=(), microphone=()';
  response.headers.set(
    'Permissions-Policy',
    `${cameraAllowlist}, geolocation=(), browsing-topics=()`
  );

  // Set x-nonce header for server components (admin/auth routes only)
  // 2026 pattern: Also include it in the response so it's visible in dev tools / debug
  if (nonce) {
    response.headers.set('x-nonce', nonce);
  }

  // Set pathname header for server components to detect current route
  response.headers.set('x-pathname', pathname);

  if (routeType === 'storefront') {
    // Defense in depth for direct middleware responses. Rewritten PPR HTML can
    // overwrite Vary later, so product-like rewrites also carry the internal
    // metadata bucket query param set before Next renders the route.
    appendVaryHeader(response, STOREFRONT_METADATA_CACHE_BUCKET_HEADER);
  }

  // HSTS: Enforce HTTPS with subdomains and preload (Lighthouse Best Practice)
  // Skip on localhost to avoid Unlighthouse/CI failures (ERR_SSL_PROTOCOL_ERROR)
  if (hostname && !isLocalhost(hostname)) {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    );
  }

  // COOP: Isolate top-level window from cross-origin documents (Lighthouse Best Practice)
  response.headers.set(
    'Cross-Origin-Opener-Policy',
    'same-origin-allow-popups'
  );

  // COEP: Cross-Origin Embedder Policy for SharedArrayBuffer support
  // Note: Google Ads/GPT don't support COEP yet, so we only apply it to admin/auth routes
  // where third-party ad embeds aren't needed. Storefront routes skip COEP to allow ads.
  // See: https://developers.google.com/publisher-tag/guides/cross-origin-embedder-policy
  if (routeType === 'admin' || routeType === 'auth') {
    response.headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
  }
  // Storefront and API routes: no COEP to allow Google Ads iframes

  // Detect bots/crawlers for optimized SEO caching
  const isBot = BOT_USER_AGENT_REGEX.test(userAgent);

  // Add cache headers for static assets
  if (
    (pathname.startsWith('/_next/static') ||
      pathname.startsWith('/images') ||
      pathname.match(IMAGE_FILES_REGEX)) &&
    pathname !== '/favicon.ico'
  ) {
    response.headers.set(
      'Cache-Control',
      'public, max-age=31536000, immutable'
    );
    return response;
  }

  // Cache product feed APIs - longer for bots
  if (
    pathname.startsWith('/api/feed/google-merchant') ||
    pathname.startsWith('/api/feed/facebook') ||
    pathname.startsWith('/api/feed/tiktok')
  ) {
    response.headers.set(
      'Cache-Control',
      isBot
        ? 's-maxage=7200, stale-while-revalidate=172800'
        : 's-maxage=3600, stale-while-revalidate=86400'
    );
    return response;
  }

  // Keep SEO listing subroutes cacheable; they share the 3-segment shape used
  // by category PDPs but do not stream PDP metadata/content slots.
  if (isStorefrontNestedListingPath(pathname, hostname, routeType)) {
    const hasCacheableMethod =
      request?.method === 'GET' || request?.method === 'HEAD';
    const hasQuery = request ? request.nextUrl.search.length > 0 : true;
    const hasAuthSessionHint = hasStorefrontAuthSessionHint(request);

    if (!hasCacheableMethod || hasQuery || hasAuthSessionHint) {
      response.headers.set(
        'Cache-Control',
        NON_CACHEABLE_STOREFRONT_HTML_CACHE_CONTROL
      );
      response.headers.delete('Vercel-Cache-Tag');
      if (hasAuthSessionHint) {
        appendVaryHeader(response, 'Cookie');
      }
      return response;
    }

    response.headers.set(
      'Cache-Control',
      isBot
        ? 's-maxage=1800, stale-while-revalidate=7200'
        : 's-maxage=300, stale-while-revalidate=86400'
    );
    const publicationCacheTag = getStorefrontPublicationResponseCacheTag(
      pathname,
      hostname
    );
    if (publicationCacheTag) {
      response.headers.set('Vercel-Cache-Tag', publicationCacheTag);
    } else {
      response.headers.delete('Vercel-Cache-Tag');
    }
    return response;
  }

  // Storefront HTML documents. Public anonymous documents get a short CDN TTL:
  // home, catalog/category listings, canonical PDPs, public blog pages, and
  // static trust/content pages. Per-user route groups like account, checkout,
  // cart, wallet, receipts, and order-success MUST stay no-store so the edge
  // never caches private or non-canonical content.
  if (shouldSetStorefrontDocumentCacheControl(pathname, hostname, routeType)) {
    // Fail safe: if the request is unavailable we cannot confirm the URL is
    // param-free, so treat it as having a query (not cacheable).
    const hasCacheableMethod =
      request?.method === 'GET' || request?.method === 'HEAD';
    const hasQuery = request ? request.nextUrl.search.length > 0 : true;
    const hasAuthSessionHint = hasStorefrontAuthSessionHint(request);
    const cacheable =
      hasCacheableMethod &&
      !hasAuthSessionHint &&
      isCacheablePublicStorefrontDocument(
        pathname,
        hostname,
        routeType,
        hasQuery
      );
    const cachePolicy = getStorefrontPublicCachePolicy(pathname, hostname);
    const cacheKind = selectStorefrontDocumentCacheKind({
      cacheable: !hasAuthSessionHint && cacheable,
      hasPurgePolicy: Boolean(cachePolicy),
      isPdp: isStorefrontPdpDocument(pathname, hostname, routeType),
      durablePdpPurge: cachePolicy?.durablePdpPurge === true,
      canUseLongCache: canUseLongDownstreamStorefrontCache(
        pathname,
        hostname,
        routeType
      ),
    });
    applyStorefrontDocumentCacheHeaders(
      response,
      cacheKind,
      getStorefrontPublicationResponseCacheTag(pathname, hostname)
    );
    if (hasAuthSessionHint) {
      appendVaryHeader(response, 'Cookie');
    }
    return response;
  }

  // No cache for authenticated routes
  if (pathname.startsWith('/dashboard') || pathname.startsWith('/api')) {
    response.headers.set(
      'Cache-Control',
      'no-cache, must-revalidate, max-age=0'
    );
    return response;
  }

  return response;
}

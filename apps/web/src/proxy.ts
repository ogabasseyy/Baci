/**
 * Next.js 16 Proxy (Middleware)
 *
 * Handles:
 * - Multi-tenant routing (subdomains and custom domains)
 * - Security headers (CSP, HSTS, COOP, COEP)
 * - Authentication session management
 * - Ad tracking cookie capture
 * - Cache control per route type
 *
 * Note: Next.js 16 renamed middleware → proxy for security clarity.
 * This file serves as the application's middleware layer.
 * See: https://nextjs.org/docs/app/building-your-application/routing/middleware
 */

import { trace } from '@opentelemetry/api';
import { NextRequest, NextResponse } from 'next/server';
import { STOREFRONT_AGENT_ROUTES } from '@/config/storefront-agent-routes';
import {
  STOREFRONT_PUBLIC_CACHE_POLICIES,
  type StorefrontPublicCachePolicy,
} from '@/config/storefront-cache';
import {
  buildStorefrontDocumentCacheHeaders,
  type StorefrontDocumentCacheKind,
} from '@/config/storefront-cdn-cache-control';
import { STOREFRONT_FEED_ROUTES } from '@/config/storefront-feed-routes';
import {
  getStorefrontForwardedBotUserAgent,
  getStorefrontMetadataCacheBucket,
  STOREFRONT_METADATA_CACHE_BUCKET_HEADER,
  STOREFRONT_METADATA_CACHE_BUCKET_QUERY_PARAM,
} from '@/config/storefront-metadata-cache-bots';
import { getInternalApiSecret } from '@/env';
import type { BlogListingStatusIntent } from '@/lib/cached-storefront-blog-listing-status';
import {
  getCustomDomainForSlug,
  getSlugForCustomDomain,
} from '@/lib/domain-cache-simple';
import { hasValidInternalAuth } from '@/lib/internal-auth-header';
import { checkRateLimit, createRateLimitResponse } from '@/lib/rate-limit';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';
import { resolveStorefrontBlogListingStatus } from '@/lib/storefront-blog-listing-status';
import { resolveStorefrontBlogPostStatus } from '@/lib/storefront-blog-post-status';
import { resolveStorefrontCompareHubStatus } from '@/lib/storefront-compare-hub-status';
import { createStorefrontComparePageHardStatusResolver } from '@/lib/storefront-compare-page-hard-status';
import { getStorefrontDocumentHomePath } from '@/lib/storefront-document-home-path';
import type { StorefrontDocumentHomePathRules } from '@/lib/storefront-document-home-path-rules';
import { isStorefrontDocumentNavigation } from '@/lib/storefront-document-navigation';
import { getStorefrontPdpFirstSegmentGate } from '@/lib/storefront-pdp-first-segment-gate';
import { getStorefrontProductCanonicalRedirectResult } from '@/lib/storefront-product-canonical-redirect';
import { resolveStorefrontProductSlugResolution } from '@/lib/storefront-product-slug-membership';
import { getStorefrontPublicationCacheTag } from '@/lib/storefront-publication-cache-tag';
import { hasUnsafeStorefrontPdpSegments } from '@/lib/storefront-unsafe-pdp-segments';
import { updateSession } from '@/lib/supabase/middleware';

// Root domain - merchants get subdomains like ogabassey.usebaci.com
// Sanitize: trim whitespace and remove any stray newlines (env variable corruption protection)
const ROOT_DOMAIN = (process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'usebaci.com')
  .trim()
  .replace(/[\r\n]/g, '');

// Reserved subdomains that should not be treated as merchant stores
// Infra subdomains that must NOT route to a merchant storefront. Keep in sync with
// INFRA_RESERVED_SUBDOMAINS in apps/web/src/lib/validation.ts and the infra names in
// is_reserved_merchant_slug() (migration 20260707074000): a name reserved from being
// a merchant slug must also be excluded from subdomain->storefront routing here, or
// e.g. cdn.usebaci.com would be rewritten into a (non-existent) storefront path.
const RESERVED_SUBDOMAINS = new Set([
  'www',
  'app',
  'api',
  'admin',
  'dashboard',
  'mail',
  'smtp',
  'assets',
  'static',
  'cdn',
  'status',
  'support',
  'help',
]);

// Valid subdomain pattern: alphanumeric and hyphens, 1-63 chars, no leading/trailing hyphens
const VALID_SUBDOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const CACHE_UNSAFE_ENCODED_DOUBLE_QUOTE_REGEX = /%e2%80%(?:9c|9d|b3)/gi;
const CACHE_UNSAFE_ENCODED_SINGLE_QUOTE_REGEX = /%e2%80%(?:98|99|b2)/gi;
const CACHE_UNSAFE_ENCODED_SPACE_OR_DASH_REGEX =
  /(?:%c2%a0|%e2%80%(?:90|91|92|93|94|95))/gi;

// Platform-owned IndexNow key file. Scoped to this exact path so that merchants
// remain free to publish their own `/<key>.txt` file on custom domains without
// the proxy intercepting and bypassing their storefront rewrite.
const INDEXNOW_KEY_PATH = '/0751d5c882ab3d7c013ecbfe9e624d71.txt';
const ANALYTICS_CONVERSION_API_PATH = '/api/analytics/conversion';
const LEGACY_ANALYTICS_CONVERSION_PATH = '/analytics/conversion';
const KLUMP_WEBHOOK_API_PATH = '/api/payments/klump/webhook';
const LEGACY_KLUMP_WOOCOMMERCE_WEBHOOK_PATH = '/wc-api/klp_wc_payment_webhook';
const CANONICAL_STOREFRONT_TERMS_PATH = '/terms';
const DEFAULT_POSTHOG_RELAY_PATH = '/baci-relay';
const HARD_STATUS_HOME_PATH_PATTERN = /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*)?$/;
const RESERVED_POSTHOG_RELAY_PATH_PREFIXES = [
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
const POSTHOG_RELAY_CREDENTIAL_HEADERS = [
  'authorization',
  'cookie',
  'proxy-authorization',
  'referer',
  'x-csrf-token',
  'x-supabase-auth-token',
] as const;
const STATIC_ASSET_EXTENSION_REGEX =
  /\.(?:svg|png|jpg|jpeg|gif|webp|avif|woff|woff2|ttf|eot|css|js|json)$/i;
const POSTHOG_RELAY_PATH = normalizePostHogRelayPath(
  process.env.NEXT_PUBLIC_POSTHOG_PROXY_PATH
);
const LEGACY_STOREFRONT_TERMS_ALIAS_PATHS = new Set([
  '/terms-and-conditions',
  '/terms-of-service',
]);
const STOREFRONT_ROOT_SITEMAP_PATH = '/sitemap.xml';
const STOREFRONT_ROOT_SITEMAP_REWRITE_PATH = '/sitemap/root.xml';
const PUBLIC_MACHINE_READABLE_PATHS = new Set<string>([
  ...Object.values(STOREFRONT_AGENT_ROUTES),
  ...Object.values(STOREFRONT_FEED_ROUTES),
]);
const MERCHANT_CONTEXT_HEADERS = [
  'x-custom-domain',
  'x-merchant-domain',
  'x-merchant-slug',
] as const;
function appendVaryHeader(response: NextResponse, value: string): void {
  const currentValue = response.headers.get('Vary');
  const existingValues =
    currentValue?.split(',').map((entry) => entry.trim().toLowerCase()) ?? [];

  if (existingValues.includes(value.toLowerCase())) {
    return;
  }

  response.headers.set(
    'Vary',
    currentValue ? `${currentValue}, ${value}` : value
  );
}

function buildProxyRequestHeaders(request: NextRequest): Headers {
  const headers = new Headers(request.headers);
  for (const header of MERCHANT_CONTEXT_HEADERS) {
    headers.delete(header);
  }
  const userAgent = request.headers.get('user-agent') ?? '';
  headers.set(
    STOREFRONT_METADATA_CACHE_BUCKET_HEADER,
    getStorefrontMetadataCacheBucket(userAgent)
  );
  // Blocking-bucket bots that Next's hardcoded getBotType() would treat as
  // humans (SemrushBot, AhrefsBot, GPTBot, …) would otherwise receive the raw
  // application/x-nextjs-pre-render postponed state on PPR routes. Forward an
  // annotated UA so the origin performs a full blocking HTML render for them
  // (see storefront-metadata-cache-bots.ts).
  const forwardedUserAgent = getStorefrontForwardedBotUserAgent(userAgent);
  if (forwardedUserAgent !== userAgent) {
    headers.set('user-agent', forwardedUserAgent);
  }
  return headers;
}

function buildPostHogRelayRequestHeaders(request: NextRequest): Headers {
  const headers = buildProxyRequestHeaders(request);
  for (const header of POSTHOG_RELAY_CREDENTIAL_HEADERS) {
    headers.delete(header);
  }
  return headers;
}

function setStorefrontMetadataCacheBucketSearchParam(
  url: URL,
  request: NextRequest
): void {
  url.searchParams.set(
    STOREFRONT_METADATA_CACHE_BUCKET_QUERY_PARAM,
    getStorefrontMetadataCacheBucket(request.headers.get('user-agent') ?? '')
  );
}

function normalizeStorefrontTermsAliasPath(pathname: string): string {
  const lookupPathname =
    pathname.length > 1 && pathname.endsWith('/')
      ? pathname.slice(0, -1)
      : pathname;

  return LEGACY_STOREFRONT_TERMS_ALIAS_PATHS.has(lookupPathname.toLowerCase())
    ? CANONICAL_STOREFRONT_TERMS_PATH
    : pathname;
}

function buildLegacyTermsAliasRedirectResponse(
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

function isPublicMachineReadablePath(pathname: string): boolean {
  return PUBLIC_MACHINE_READABLE_PATHS.has(pathname);
}

function normalizePostHogRelayPath(value?: string): string {
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

function isReservedPostHogRelayPath(pathname: string): boolean {
  const normalized = pathname.toLowerCase();
  return RESERVED_POSTHOG_RELAY_PATH_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`)
  );
}

function isPostHogRelayPath(pathname: string): boolean {
  return (
    pathname === POSTHOG_RELAY_PATH ||
    pathname.startsWith(`${POSTHOG_RELAY_PATH}/`)
  );
}

function isStaticAssetOutsidePostHogRelay(pathname: string): boolean {
  return (
    /\/(?:static|array)\//.test(pathname) &&
    STATIC_ASSET_EXTENSION_REGEX.test(pathname) &&
    !isPostHogRelayPath(pathname)
  );
}

function isPlatformHost(hostname: string): boolean {
  return (
    isRootDomain(hostname, ROOT_DOMAIN) ||
    isVercelPreview(hostname) ||
    (isLocalhost(hostname) && extractLocalhostSubdomain(hostname) === null)
  );
}

// Pre-compiled regex patterns for performance (avoids recompilation on every request)
const STATIC_FILES_REGEX =
  /\.(jpg|jpeg|png|gif|svg|ico|webp|avif|woff|woff2|ttf|eot|css|js|json)$/;
const IMAGE_FILES_REGEX =
  /\.(jpg|jpeg|png|gif|svg|ico|webp|avif|woff|woff2|ttf|eot)$/;
const BOT_USER_AGENT_REGEX =
  /bot|crawler|spider|crawling|googlebot|bingbot|slurp|duckduckbot|baiduspider|yandexbot|facebookexternalhit|twitterbot|rogerbot|linkedinbot|embedly|quora link preview|showyoubot|outbrain|pinterest|slackbot|vkShare|W3C_Validator/i;
const PROTOCOL_SCHEME_REGEX = /^[a-z][a-z0-9+.-]*:/i;
const NESTED_PRODUCT_SUBROUTE_EXCLUSIONS = new Set(['best-under', 'compare']);
// Second segments of 2-segment storefront paths that are real listing routes,
// not PDPs: `/{category}/compare` is the per-category compare hub served by
// `(storefront)/[slug]/(catalog)/(listing)/[category]/compare/page.tsx`, so its
// second segment must never be resolved against the product slug set — the PDP
// preflights would hard-404 (or falsely 308) the live hub. Deliberately
// narrower than NESTED_PRODUCT_SUBROUTE_EXCLUSIONS: `/{category}/best-under`
// has no 2-segment route, so a bare best-under path must keep hard-404ing.
const CATEGORY_LISTING_HUB_SEGMENTS = new Set(['compare']);
const PDP_HTML_CACHE_CONTROL = 'no-cache, no-store, max-age=0, must-revalidate';
const NON_CACHEABLE_STOREFRONT_HTML_CACHE_CONTROL =
  'private, no-store, max-age=0, must-revalidate';
const BLOG_STATUS_PREFLIGHT_EXCLUDED_SLUGS = new Set([
  'feed.xml',
  'news-sitemap.xml',
  'opengraph-image',
  'rss.xml',
  'sitemap.xml',
  'twitter-image',
]);
const DRAFT_MODE_COOKIE_NAMES = ['__prerender_bypass', '__next_preview_data'];

// UUID-shaped product URL segment — resolved by the PDP route's id lookup, so
// the crawl-budget slug-set check (which holds slugs, not ids) must skip it.
const UUID_SHAPED_SLUG =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Decode a raw URL path segment for slug comparison. Path segments arrive
// percent-encoded while DB slugs are decoded; a malformed sequence (e.g. a lone
// `%`) throws — fall back to the raw value so a bad encoding never crashes the
// proxy (worst case: it simply won't match and falls through, never 404ing).
function safeDecodeSegment(segment: string | undefined): string {
  if (!segment) {
    return '';
  }
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

// True only for an internal request bearing the correct `INTERNAL_API_SECRET`
// (timing-safe), via EITHER the custom `x-baci-internal-auth` header (used by
// the cache-eligible preflight self-fetches) or the legacy `Authorization`
// bearer. Used to scope the rate-limit exemption to AUTHENTICATED self-calls —
// an unauthenticated/forged request to `/api/internal/*` stays rate-limited, so
// the secret cannot be flooded/guessed without a 429.
function isAuthenticatedInternalRequest(request: NextRequest): boolean {
  const secret = getInternalApiSecret();
  if (!secret) {
    return false;
  }
  return hasValidInternalAuth(request, secret);
}
// Cacheable public storefront documents (home, PDP, category, blog, static
// content) emit the LAYERED Ops-2 header set from
// config/storefront-cdn-cache-control.ts: a bfcache-safe browser Cache-Control,
// a short-fresh/long-SWR `Vercel-CDN-Cache-Control` for Vercel's CDN, and a
// route-aware `CDN-Cache-Control` forwarded to Cloudflare. The long CF value
// matches the
// zone cache rule's existing Edge TTL (Ops-1), so freshness on custom domains
// is unchanged until the dashboard rule is flipped to "respect origin" — after
// which this header becomes the single source of truth. PDPs retain the 300s
// self-healing window because high-cardinality product operations intentionally
// purge listings only; non-policy storefronts stay Vercel-only because they
// have no Cloudflare purge target.
function applyStorefrontDocumentCacheHeaders(
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
const STOREFRONT_METADATA_CACHE_NON_HTML_EXTENSIONS_REGEX =
  /\.(?:json|jsonl|md|txt|webmanifest|xml)$/i;
const STOREFRONT_METADATA_CACHE_NON_HTML_SEGMENTS = new Set(['_next', 'api']);
const STOREFRONT_METADATA_CACHE_NON_HTML_ROUTE_SEGMENTS = new Set([
  'apple-icon',
  'icon',
  'opengraph-image',
  'twitter-image',
]);
const STOREFRONT_METADATA_CACHE_NON_SEO_SEGMENTS = new Set([
  'account',
  'cart',
  'checkout',
  'delete-account',
  'my-account',
  'order-success',
  'receipts',
  'track-order',
  'wallet',
  'wishlist',
]);
const PLATFORM_ROOT_ROUTE_SEGMENTS = new Set([
  '_next',
  'about',
  'admin',
  'api',
  'auth',
  'blog',
  'builder',
  'cart',
  'checkout',
  'contact',
  'debug-auth',
  'delete-account',
  'demo',
  'developers',
  'features',
  'favicon.ico',
  'feeds',
  'forgot-password',
  'invite',
  'login',
  'manifest.webmanifest',
  'onboarding',
  'pricing',
  'privacy',
  'products',
  'reset-password',
  'robots.txt',
  'signup',
  'sitemap.xml',
  'staff',
  'template-preview',
  'terms',
  'track',
  'update-password',
  'verify',
]);
// Matches blog index/post paths on both the platform root (`/blog`, `/blog/...`)
// and slug-prefixed storefront variants served from the root domain
// (`/{slug}/blog`, `/{slug}/blog/...`). Used to canonicalize thumbnail params.
// The negative lookahead excludes reserved top-level routes (API handlers,
// dashboard screens, etc.) that happen to have a `/blog` child segment —
// e.g. `/api/blog/posts` must reach its handler instead of being redirected.
const BLOG_PATH_REGEX =
  /^(?:\/(?!(?:api|dashboard|admin|auth|login|onboarding|builder|reset-password|checkout|cart|staff|invite|actions|about|contact|pricing|privacy|terms|features|developers|demo|debug-auth|template-preview|track|_next|sitemap\.xml|robots\.txt|manifest\.webmanifest|favicon\.ico)(?:\/|$))[^/]+)?\/blog(?:\/.*)?$/;

// Cache routing must classify the public URL shape, not the rewritten path:
// root/preview/plain-localhost storefronts are `/{slug}/...`, while custom
// domains and merchant subdomains start directly at the storefront content path.
function isSlugPrefixedStorefrontRequest(
  hostname: string | undefined
): boolean {
  return hostname ? isPlatformHost(hostname) : false;
}

function getStorefrontContentSegments(
  pathname: string,
  hostname: string | undefined,
  routeType: 'admin' | 'auth' | 'storefront' | 'api'
): string[] {
  if (routeType !== 'storefront') {
    return [];
  }

  const pathSegments = pathname.split('/').filter(Boolean);
  return isSlugPrefixedStorefrontRequest(hostname)
    ? pathSegments.slice(1)
    : pathSegments;
}

function normalizePathnameForCompare(pathname: string): string {
  return (pathname.replace(/\/+$/g, '') || '/').toLowerCase();
}

function getNestedProductSubrouteSegment(
  pathname: string,
  hostname: string | undefined,
  routeType: 'admin' | 'auth' | 'storefront' | 'api'
): string | null {
  const contentSegments = getStorefrontContentSegments(
    pathname,
    hostname,
    routeType
  );
  if (contentSegments.length !== 3) {
    return null;
  }

  return contentSegments[1] ?? null;
}

function isStorefrontNestedListingPath(
  pathname: string,
  hostname: string | undefined,
  routeType: 'admin' | 'auth' | 'storefront' | 'api'
): boolean {
  const subrouteSegment = getNestedProductSubrouteSegment(
    pathname,
    hostname,
    routeType
  );
  return (
    subrouteSegment !== null &&
    NESTED_PRODUCT_SUBROUTE_EXCLUSIONS.has(subrouteSegment)
  );
}

function isStorefrontProductPagePath(
  pathname: string,
  hostname: string | undefined,
  routeType: 'admin' | 'auth' | 'storefront' | 'api'
): boolean {
  const contentSegments = getStorefrontContentSegments(
    pathname,
    hostname,
    routeType
  );
  if (contentSegments.length === 2) {
    return true;
  }

  const subrouteSegment = getNestedProductSubrouteSegment(
    pathname,
    hostname,
    routeType
  );
  if (subrouteSegment === null) {
    return false;
  }

  return !NESTED_PRODUCT_SUBROUTE_EXCLUSIONS.has(subrouteSegment);
}

function shouldPartitionStorefrontMetadataCache(
  pathname: string,
  hostname: string | undefined,
  routeType: 'admin' | 'auth' | 'storefront' | 'api'
): boolean {
  if (routeType !== 'storefront') {
    return false;
  }

  const lowerPathname = pathname.toLowerCase();
  if (
    isPublicMachineReadablePath(pathname) ||
    STATIC_FILES_REGEX.test(lowerPathname) ||
    STOREFRONT_METADATA_CACHE_NON_HTML_EXTENSIONS_REGEX.test(lowerPathname)
  ) {
    return false;
  }

  const pathSegments = pathname.split('/').filter(Boolean);
  if (isSlugPrefixedStorefrontRequest(hostname)) {
    const slugSegment = pathSegments[0]?.toLowerCase();
    if (
      !slugSegment ||
      !isValidSubdomain(slugSegment) ||
      RESERVED_SUBDOMAINS.has(slugSegment) ||
      RESERVED_STOREFRONT_SEGMENTS.has(slugSegment) ||
      PLATFORM_ROOT_ROUTE_SEGMENTS.has(slugSegment)
    ) {
      return false;
    }
  }

  const contentSegments = getStorefrontContentSegments(
    pathname,
    hostname,
    routeType
  );
  const firstSegment = contentSegments[0]?.toLowerCase();

  if (
    firstSegment &&
    (STOREFRONT_METADATA_CACHE_NON_HTML_SEGMENTS.has(firstSegment) ||
      STOREFRONT_METADATA_CACHE_NON_SEO_SEGMENTS.has(firstSegment))
  ) {
    return false;
  }

  return !contentSegments.some((segment) =>
    STOREFRONT_METADATA_CACHE_NON_HTML_ROUTE_SEGMENTS.has(segment.toLowerCase())
  );
}

// Routes that should not be rewritten (main app routes)
const MAIN_APP_ROUTES = [
  '/dashboard',
  // '/api', // Allow API access on subdomains (controlled by middleware)
  '/auth',
  '/login',
  // Platform auth/staff pages under app/(auth)/ + the staff-invite flow. Like
  // '/login', these live only on the platform (never a storefront), so on a
  // subdomain they must redirect to usebaci.com/<route> and be EXCLUDED from the
  // retired-slug storefront redirect — otherwise old.usebaci.com/signup would be
  // sent to the current store's /signup (404) after a rename.
  '/signup',
  '/forgot-password',
  '/update-password',
  '/verify',
  '/staff',
  '/onboarding',
  '/builder',
  '/reset-password',
  POSTHOG_RELAY_PATH,
  '/_next',
  '/robots.txt',
  '/manifest.webmanifest',
];

/**
 * Boundary-aware MAIN_APP_ROUTES match: `/staff` matches `/staff` and `/staff/...`
 * but NOT a storefront category like `/staff-picks` or `/signup-sale`. A bare
 * `startsWith(route)` would misclassify those valid storefront URLs as platform
 * routes and redirect them off the merchant storefront.
 */
function matchesMainAppRoute(pathname: string): boolean {
  return MAIN_APP_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

// Platform root routes that should still be served by the main app but cannot
// live in MAIN_APP_ROUTES because merchant subdomains need storefront versions.
const ROOT_DOMAIN_ONLY_MAIN_APP_ROUTES = ['/checkout'];

// Prefixes whose tail segments may be case-sensitive (tracking numbers,
// API identifiers, build IDs). Only the prefix itself is lowercased.
// Important: do NOT derive from MAIN_APP_ROUTES wholesale — /checkout
// overlaps real storefront paths and must stay eligible for the later
// storefront-wide lowercase redirect.
const CASE_PRESERVING_PREFIXES = [
  '/api',
  '/track',
  '/_next',
  '/dashboard',
  '/auth',
  '/login',
  '/onboarding',
  '/builder',
  '/reset-password',
  POSTHOG_RELAY_PATH,
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml',
  '/manifest.webmanifest',
];

const RESERVED_STOREFRONT_SEGMENTS = new Set([
  'about',
  'account',
  'api',
  'blog',
  'cart',
  // Legacy category roots — `/category/{slug}` and `/product-category/{slug}`
  // resolve to category pages (see storefront-link-normalization.ts), so they
  // must NOT be collapsed to `/products/{slug}` when stripping a merchant slug
  // prefix on custom domains.
  'category',
  'checkout',
  'faq',
  'llms-full.txt',
  'llms.txt',
  'pages',
  'privacy-policy',
  'product-category',
  'products',
  'repair',
  'repairs',
  'robots.txt',
  'sitemap',
  'swap',
  'terms',
  'track-order',
  'wallet',
  'wishlist',
]);

// Public single-segment storefront documents that are safe to edge-cache for
// every tenant. Merchant-specific category roots belong in per-tenant sets.
const CACHEABLE_PUBLIC_STOREFRONT_FIRST_SEGMENTS = new Set([
  'about',
  'blog',
  'contact',
  'faq',
  'privacy',
  'privacy-policy',
  'products',
  'returns',
  'shipping',
  'terms',
  'terms-and-conditions',
  'terms-of-service',
  'warranty',
]);

const STOREFRONT_CACHE_POLICIES_BY_SLUG = new Map<
  string,
  StorefrontPublicCachePolicy
>(
  STOREFRONT_PUBLIC_CACHE_POLICIES.map((policy) => [
    policy.slug.toLowerCase(),
    policy,
  ])
);
const STOREFRONT_CACHE_POLICIES_BY_HOSTNAME = new Map<
  string,
  StorefrontPublicCachePolicy
>(
  STOREFRONT_PUBLIC_CACHE_POLICIES.flatMap((policy) =>
    policy.customHostnames.map(
      (hostname) => [normalizeHostname(hostname), policy] as const
    )
  )
);
const CACHEABLE_PUBLIC_STOREFRONT_CATEGORY_SEGMENTS_BY_SLUG = new Map<
  string,
  Set<string>
>(
  STOREFRONT_PUBLIC_CACHE_POLICIES.map((policy) => [
    policy.slug.toLowerCase(),
    new Set<string>(
      policy.cacheableCategorySegments.map((segment) => segment.toLowerCase())
    ),
  ])
);

// First content segments that must NEVER be edge-cached as a public document.
// = RESERVED_STOREFRONT_SEGMENTS plus the per-user/authenticated route groups
// not already reserved: (customer) my-account/delete-account/receipts,
// (commerce) order-success, (utility) member-status/imei-check/quiz/reviews.
// Keep this in sync with the (customer)/(commerce)/(utility) route groups —
// caching any of these would leak per-user content (orders, receipts, etc.).
// The canonical PDP/category shape (`/<category>/<product>`) is intentionally
// NOT in this set, so it remains cacheable.
const NON_CACHEABLE_STOREFRONT_FIRST_SEGMENTS = new Set<string>([
  ...RESERVED_STOREFRONT_SEGMENTS,
  // Singular `/product/{slug}` is a legacy redirect-only / noindex route (not in
  // RESERVED, which only has plural `products`) — keep it no-store.
  'product',
  'my-account',
  'delete-account',
  'receipts',
  'order-success',
  'member-status',
  'imei-check',
  'quiz',
  'reviews',
]);

// Every FIRST URL segment that resolves to a real storefront route under
// (storefront)/[slug]/... — verified exhaustively against that route tree
// (blog/catalog/commerce/content/customer/utility groups + the top-level
// `storefront` legacy segment). Superset of NON_CACHEABLE_STOREFRONT_FIRST_SEGMENTS.
//
// Used ONLY by the retired-slug PREFIX strip on custom domains: a merchant can
// retire a slug that happens to equal a route name (e.g. a store once slugged
// "blog"), which becomes an alias. On its custom domain, custom.example/blog/post
// is a LIVE /blog route serving many URLs, so it must NOT be mistaken for a
// legacy /<oldSlug>/... link and stripped to /post. A live route always wins
// over redirects for a narrow set of ambiguous legacy links. Keep in sync with
// the (storefront)/[slug] route groups.
const STOREFRONT_ROUTE_FIRST_SEGMENTS = new Set<string>([
  ...NON_CACHEABLE_STOREFRONT_FIRST_SEGMENTS,
  'compare',
  'search',
  'contact',
  'privacy',
  'returns',
  'shipping',
  'warranty',
  'terms-and-conditions',
  'terms-of-service',
  'storefront',
]);

// Live storefront PAGE first-segments that must be excluded from the
// retired-slug PREFIX STRIP but from NOTHING ELSE.
//
// `unlock-orders` is a real (storefront)/[slug]/unlock-orders page, and it was
// the only live first segment missing from the strip's exclusion list — so on a
// custom domain a merchant whose RETIRED slug was "unlock-orders" had their own
// live page 302-stripped as if it were a legacy slug-prefixed link.
//
// It gets its own set because every existing set is too broad for it:
//   - RESERVED_STOREFRONT_SEGMENTS also drives merchant-slug validity
//     (isStorefrontHomeDocument), the metadata-cache partition and the PDP
//     hard-404 / canonical-308 helpers — a merchant or PRODUCT legitimately
//     slugged `unlock-orders` would lose its CDN policy and proxy handling.
//   - NON_CACHEABLE_STOREFRONT_FIRST_SEGMENTS additionally rejects
//     `/<category>/<product>` PDPs whose CATEGORY is slugged `unlock-orders`
//     and forces those URLs to no-store.
//   - STOREFRONT_ROUTE_FIRST_SEGMENTS also guards the retired-alias API
//     rewrites (matchAliasApiPrefixShape and the custom-domain API branch), so
//     `custom.example/unlock-orders/api/...` would stop being rewritten. The
//     live page owns the exact `/unlock-orders` path only, never an `/api`
//     subtree, so that rewrite must keep working.
//
// Like `quiz`, the page is template-gated (notFound() unless
// template_id === 'ogabassey'). Treating a template-gated route as universally
// excluded is this file's existing tradeoff: the strip runs before the
// merchant's template is resolved, so the alternative is reinstating the
// shadowing bug for OgaBassey.
const RETIRED_SLUG_STRIP_LIVE_PAGE_SEGMENTS = new Set<string>([
  ...STOREFRONT_ROUTE_FIRST_SEGMENTS,
  'unlock-orders',
]);

// First URL segments that are PLATFORM/app routes reachable on a custom domain
// but are NOT (storefront)/[slug] routes — so they don't belong in
// STOREFRONT_ROUTE_FIRST_SEGMENTS (that set is kept in sync with the storefront
// route tree and would prune these). Like the storefront set, these must be
// excluded from the retired-slug PREFIX strip so a merchant whose retired slug
// is literally "auth" or "feeds" doesn't break the live route:
//   - 'auth'  -> the /auth/confirm magic-link pass-through (further down this branch)
//   - 'feeds' -> the machine-readable feed pass-through (isPublicMachineReadablePath)
// Tradeoff: an exotic genuine retired link custom.example/auth/<path> (old slug
// was "auth") no longer 301-strips and falls through to the storefront 404 —
// preserving the security-critical live /auth/confirm route is the right call.
const CUSTOM_DOMAIN_APP_ROUTE_FIRST_SEGMENTS = new Set<string>([
  'auth',
  'feeds',
]);

// Query-param names that unambiguously carry the MERCHANT slug (merchantSlug:
// shipping/quotes; merchant_slug: order tracking, order detail, feeds; merchant:
// customer wallet). When a stale client on a just-retired subdomain calls such an
// endpoint with the OLD slug in one of these params, the retired-slug API handler
// rewrites it to the current slug so the endpoint resolves the renamed store
// instead of 404ing. The bare `slug` key is deliberately EXCLUDED — it is also
// used for product/resource slugs (e.g. the proxy's own product-membership /
// canonical preflight), so rewriting it would corrupt a live product whose slug
// happens to equal a retired storefront slug.
const MERCHANT_SLUG_QUERY_PARAMS = [
  'merchantSlug',
  'merchant_slug',
  'merchant',
] as const;

function isStorefrontHomeDocument(
  pathname: string,
  hostname: string | undefined,
  routeType: 'admin' | 'auth' | 'storefront' | 'api'
): boolean {
  if (routeType !== 'storefront') {
    return false;
  }

  const pathSegments = pathname.split('/').filter(Boolean);
  if (!isSlugPrefixedStorefrontRequest(hostname)) {
    return pathSegments.length === 0;
  }

  const slugSegment = pathSegments[0]?.toLowerCase();
  return (
    pathSegments.length === 1 &&
    slugSegment !== undefined &&
    isValidSubdomain(slugSegment) &&
    !RESERVED_SUBDOMAINS.has(slugSegment) &&
    !RESERVED_STOREFRONT_SEGMENTS.has(slugSegment) &&
    !PLATFORM_ROOT_ROUTE_SEGMENTS.has(slugSegment)
  );
}

function isNonHtmlStorefrontDocumentPath(pathname: string): boolean {
  const lowerPathname = pathname.toLowerCase();
  return (
    isPublicMachineReadablePath(pathname) ||
    STATIC_FILES_REGEX.test(lowerPathname) ||
    STOREFRONT_METADATA_CACHE_NON_HTML_EXTENSIONS_REGEX.test(lowerPathname) ||
    pathname
      .split('/')
      .filter(Boolean)
      .some((segment) =>
        STOREFRONT_METADATA_CACHE_NON_HTML_ROUTE_SEGMENTS.has(
          segment.toLowerCase()
        )
      )
  );
}

function getStorefrontSlugFromRequest(
  pathname: string,
  hostname: string | undefined
): string | null {
  if (!hostname) {
    return null;
  }

  const normalizedHostname = hostname ? normalizeHostname(hostname) : '';
  const customDomainPolicy =
    STOREFRONT_CACHE_POLICIES_BY_HOSTNAME.get(normalizedHostname);
  if (customDomainPolicy) {
    return customDomainPolicy.slug.toLowerCase();
  }

  const localhostSubdomain = extractLocalhostSubdomain(normalizedHostname);
  if (localhostSubdomain) {
    return localhostSubdomain;
  }

  const rootDomainSubdomain = extractSubdomain(normalizedHostname, ROOT_DOMAIN);
  if (rootDomainSubdomain && !RESERVED_SUBDOMAINS.has(rootDomainSubdomain)) {
    return rootDomainSubdomain;
  }

  if (!isSlugPrefixedStorefrontRequest(hostname)) {
    return null;
  }

  return pathname.split('/').filter(Boolean)[0]?.toLowerCase() ?? null;
}

function getStorefrontPublicCachePolicy(
  pathname: string,
  hostname: string | undefined
) {
  const storefrontSlug = getStorefrontSlugFromRequest(pathname, hostname);
  if (!storefrontSlug) {
    return null;
  }

  return STOREFRONT_CACHE_POLICIES_BY_SLUG.get(storefrontSlug) ?? null;
}

function isCacheablePublicStorefrontFirstSegment(
  pathname: string,
  hostname: string | undefined,
  firstSegment: string
): boolean {
  const cachePolicy = getStorefrontPublicCachePolicy(pathname, hostname);
  const cacheableCategorySegments = cachePolicy
    ? CACHEABLE_PUBLIC_STOREFRONT_CATEGORY_SEGMENTS_BY_SLUG.get(
        cachePolicy.slug.toLowerCase()
      )
    : undefined;

  return (
    CACHEABLE_PUBLIC_STOREFRONT_FIRST_SEGMENTS.has(firstSegment) ||
    cacheableCategorySegments?.has(firstSegment) === true
  );
}

function isPublicReservedStorefrontDocument(
  pathname: string,
  hostname: string | undefined,
  contentSegments: string[]
): boolean {
  const firstSegment = contentSegments[0]?.toLowerCase();
  if (
    firstSegment === undefined ||
    !isCacheablePublicStorefrontFirstSegment(pathname, hostname, firstSegment)
  ) {
    return false;
  }

  if (firstSegment === 'blog') {
    return true;
  }

  return contentSegments.length === 1;
}

function isCacheableSingleSegmentStorefrontDocument(
  pathname: string,
  hostname: string | undefined,
  contentSegments: string[]
): boolean {
  const firstSegment = contentSegments[0]?.toLowerCase();
  return (
    contentSegments.length === 1 &&
    firstSegment !== undefined &&
    isCacheablePublicStorefrontFirstSegment(pathname, hostname, firstSegment)
  );
}

function isStorefrontPdpDocument(
  pathname: string,
  hostname: string | undefined,
  routeType: 'admin' | 'auth' | 'storefront' | 'api'
): boolean {
  const contentSegments = getStorefrontContentSegments(
    pathname,
    hostname,
    routeType
  );
  if (contentSegments.length !== 2) {
    return false;
  }

  const firstSegment = contentSegments[0]?.toLowerCase();
  if (firstSegment === 'products') {
    return true;
  }

  return (
    firstSegment !== undefined &&
    !NON_CACHEABLE_STOREFRONT_FIRST_SEGMENTS.has(firstSegment)
  );
}

function canUseLongDownstreamStorefrontCache(
  pathname: string,
  hostname: string | undefined,
  routeType: 'admin' | 'auth' | 'storefront' | 'api'
): boolean {
  if (isStorefrontHomeDocument(pathname, hostname, routeType)) {
    return true;
  }

  const contentSegments = getStorefrontContentSegments(
    pathname,
    hostname,
    routeType
  );
  const firstSegment = contentSegments[0]?.toLowerCase();
  if (firstSegment === 'blog') {
    return true;
  }
  if (contentSegments.length !== 1 || firstSegment === undefined) {
    return false;
  }
  if (firstSegment === 'products') {
    return true;
  }

  const cachePolicy = getStorefrontPublicCachePolicy(pathname, hostname);
  const categorySegments = cachePolicy
    ? CACHEABLE_PUBLIC_STOREFRONT_CATEGORY_SEGMENTS_BY_SLUG.get(
        cachePolicy.slug.toLowerCase()
      )
    : undefined;
  return categorySegments?.has(firstSegment) === true;
}

// A storefront document is safe to CDN-cache only when it is anonymous public
// storefront HTML on a clean canonical URL. Per-user route groups and
// param/non-canonical URLs (for example invalid `?variantId=` that streams a
// redirect) are excluded so the edge never caches private or non-canonical
// content.
function isCacheablePublicStorefrontDocument(
  pathname: string,
  hostname: string | undefined,
  routeType: 'admin' | 'auth' | 'storefront' | 'api',
  hasQuery: boolean
): boolean {
  if (routeType !== 'storefront' || hasQuery) {
    return false;
  }
  if (isNonHtmlStorefrontDocumentPath(pathname)) {
    return false;
  }
  if (isStorefrontHomeDocument(pathname, hostname, routeType)) {
    return true;
  }

  const contentSegments = getStorefrontContentSegments(
    pathname,
    hostname,
    routeType
  );
  if (contentSegments.length === 0) {
    return false;
  }

  const firstSegment = contentSegments[0]?.toLowerCase();
  if (
    firstSegment !== undefined &&
    NON_CACHEABLE_STOREFRONT_FIRST_SEGMENTS.has(firstSegment)
  ) {
    return (
      isPublicReservedStorefrontDocument(pathname, hostname, contentSegments) ||
      (firstSegment === 'products' &&
        isStorefrontProductPagePath(pathname, hostname, routeType))
    );
  }

  if (
    isCacheableSingleSegmentStorefrontDocument(
      pathname,
      hostname,
      contentSegments
    )
  ) {
    return true;
  }

  return isStorefrontProductPagePath(pathname, hostname, routeType);
}

function shouldSetStorefrontDocumentCacheControl(
  pathname: string,
  hostname: string | undefined,
  routeType: 'admin' | 'auth' | 'storefront' | 'api'
): boolean {
  if (
    routeType !== 'storefront' ||
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/api') ||
    isNonHtmlStorefrontDocumentPath(pathname)
  ) {
    return false;
  }

  if (
    isCacheablePublicStorefrontDocument(pathname, hostname, routeType, false)
  ) {
    return true;
  }

  const contentSegments = getStorefrontContentSegments(
    pathname,
    hostname,
    routeType
  );
  const firstSegment = contentSegments[0]?.toLowerCase();

  return (
    contentSegments.length === 1 ||
    (firstSegment !== undefined &&
      NON_CACHEABLE_STOREFRONT_FIRST_SEGMENTS.has(firstSegment))
  );
}

function isSupabaseAuthCookieName(cookieName: string): boolean {
  const normalizedName = cookieName.toLowerCase();
  return (
    normalizedName === 'supabase-auth-token' ||
    normalizedName.startsWith('supabase-auth-token.') ||
    (normalizedName.startsWith('sb-') && normalizedName.includes('auth-token'))
  );
}

function hasStorefrontAuthSessionHint(
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

function sanitizeProxyRedirectPath(
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

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

/**
 * If pathname starts with `prefix` (case-insensitive), return the corrected
 * pathname with only the prefix lowercased and the tail untouched.
 * Returns null when no change is needed (already correct or no match).
 */
function normalizeLeadingPrefix(
  pathname: string,
  prefix: string
): string | null {
  const lowerPathname = pathname.toLowerCase();

  if (lowerPathname === prefix) {
    return pathname === prefix ? null : prefix;
  }

  if (lowerPathname.startsWith(`${prefix}/`)) {
    return pathname.startsWith(prefix)
      ? null
      : `${prefix}${pathname.slice(prefix.length)}`;
  }

  return null;
}

function isHexDigit(char: string | undefined): boolean {
  return Boolean(char && /^[0-9A-Fa-f]$/.test(char));
}

/**
 * Lowercase only the literal pathname characters and preserve percent-encoded
 * octets exactly as sent. Percent-escape hex casing is semantically
 * equivalent, so rewriting `%E2%80%9D` to `%e2%80%9d` creates noisy
 * self-referential redirects that crawlers can misclassify as loops.
 */
function lowercaseStorefrontPathname(pathname: string): string {
  let normalized = '';

  for (let index = 0; index < pathname.length; index += 1) {
    const currentChar = pathname[index];
    const nextChar = pathname[index + 1];
    const nextNextChar = pathname[index + 2];

    if (
      currentChar === '%' &&
      isHexDigit(nextChar) &&
      isHexDigit(nextNextChar)
    ) {
      normalized += pathname.slice(index, index + 3);
      index += 2;
      continue;
    }

    normalized += currentChar.toLowerCase();
  }

  return normalized;
}

function normalizeCacheSafeStorefrontPathname(pathname: string): string | null {
  // Next remote cache currently serializes the request URL through ByteString
  // constrained headers. Keep this targeted to imported punctuation and apply
  // it on the raw URL path so existing escapes like %2F are preserved.
  const punctuationNormalizedPathname = pathname
    .split('/')
    .map((segment) =>
      segment
        .replace(CACHE_UNSAFE_ENCODED_DOUBLE_QUOTE_REGEX, '')
        .replace(CACHE_UNSAFE_ENCODED_SINGLE_QUOTE_REGEX, '')
        .replace(CACHE_UNSAFE_ENCODED_SPACE_OR_DASH_REGEX, '-')
        .replace(/[\u201c\u201d\u2033]/g, '')
        .replace(/[\u2018\u2019\u2032]/g, '')
        .replace(/[\u00a0\u2010-\u2015]/g, '-')
    )
    .join('/');

  if (punctuationNormalizedPathname === pathname) {
    return null;
  }

  const normalizedPathname = punctuationNormalizedPathname
    .split('/')
    .map((segment) => segment.replace(/-+/g, '-'))
    .join('/');

  return normalizedPathname || '/';
}

function isLegacyKlumpWooCommerceWebhookPath(pathname: string): boolean {
  const normalizedPathname =
    pathname.length > 1 && pathname.endsWith('/')
      ? pathname.slice(0, -1)
      : pathname;

  return (
    normalizedPathname.toLowerCase() === LEGACY_KLUMP_WOOCOMMERCE_WEBHOOK_PATH
  );
}

function isLegacyAnalyticsConversionPath(pathname: string): boolean {
  const normalizedPathname =
    pathname.length > 1 && pathname.endsWith('/')
      ? pathname.slice(0, -1)
      : pathname;

  return normalizedPathname.toLowerCase() === LEGACY_ANALYTICS_CONVERSION_PATH;
}

function getNoTrailingSlashRedirectPath(pathname: string): string | null {
  if (pathname === '/' || !pathname.endsWith('/')) {
    return null;
  }

  const pathnameWithoutTrailingSlash = pathname.slice(0, -1);
  if (pathnameWithoutTrailingSlash.startsWith('/.well-known/')) {
    return null;
  }

  return pathnameWithoutTrailingSlash;
}

/**
 * Normalize hostname: remove port and convert to lowercase
 */
function normalizeHostname(hostname: string): string {
  return hostname.split(':')[0].toLowerCase();
}

async function getSlugForOriginCustomDomain(
  hostname: string
): Promise<string | null> {
  const normalizedHostname = normalizeHostname(hostname);

  if (normalizedHostname.startsWith('www.')) {
    const apexHostname = normalizedHostname.slice('www.'.length);
    const apexSlug = await getSlugForCustomDomain(apexHostname);
    if (apexSlug) {
      return apexSlug;
    }
  }

  return getSlugForCustomDomain(normalizedHostname);
}

/**
 * Validate subdomain follows DNS standards
 * - Only lowercase alphanumeric and hyphens
 * - 1-63 characters
 * - Cannot start or end with hyphen
 */
function isValidSubdomain(subdomain: string): boolean {
  return VALID_SUBDOMAIN_REGEX.test(subdomain);
}

/**
 * Shape check only: if `pathname` looks like a `/<slugPrefix>/api/...` path whose
 * prefix could be a retired alias (valid subdomain shape, not a storefront/app-route
 * segment), return `{ apiPathname, prefix }`; otherwise null. Confirmation that it is
 * ACTUALLY a retired-alias API request (and will be rewritten) happens via the alias
 * lookup — this must mirror the rewrite branches' filter exactly, or the pre-rewrite
 * API guard (rate limit / CSRF / body-size) would skip a request the rewrite handles.
 * RESERVED_SUBDOMAINS is intentionally NOT excluded: the custom-domain and root-path
 * rewrites resolve grandfathered reserved-name aliases (e.g. `support`, `cdn`), so the
 * guard must too. A non-alias reserved prefix simply resolves to no alias downstream.
 */
function matchAliasApiPrefixShape(
  pathname: string
): { apiPathname: string; prefix: string } | null {
  const [first, second] = pathname.split('/').filter(Boolean);
  if (!first || second?.toLowerCase() !== 'api') {
    return null;
  }
  const prefix = first.toLowerCase();
  if (
    !isValidSubdomain(prefix) ||
    STOREFRONT_ROUTE_FIRST_SEGMENTS.has(prefix) ||
    CUSTOM_DOMAIN_APP_ROUTE_FIRST_SEGMENTS.has(prefix)
  ) {
    return null;
  }
  return { apiPathname: pathname.slice(first.length + 1) || '/', prefix };
}

/**
 * Same-origin /api handling for a request on a `{slug}.usebaci.com` subdomain (live
 * OR retired). A cross-origin 301 would drop same-origin cookies / CORS-fail
 * credentialed fetches and discard POST bodies, so the request is passed through /
 * rewritten on the retired host. x-merchant-slug stays the PRESENTED (old) subdomain
 * slug — the shipping resolver only trusts it when host === `${slug}.usebaci.com`
 * (anti-spoof) and falls back to the alias table on a miss — and stale slug-bearing
 * QUERY params are corrected to the current slug (query-based endpoints resolve the
 * merchant from these). Shared by the normal subdomain branch and the reserved-
 * subdomain fallback (grandfathered infra-name aliases).
 */
async function buildSubdomainApiResponse(
  request: NextRequest,
  subdomain: string,
  hostname: string,
  userAgent: string
): Promise<NextResponse> {
  const requestHeaders = buildProxyRequestHeaders(request);
  requestHeaders.set('x-merchant-slug', subdomain);

  let rewrittenApiUrl: URL | null = null;
  if (!isLocalhost(hostname)) {
    const hostAliasCurrentSlug = await getCurrentSlugForAlias(subdomain);
    const currentSlug = hostAliasCurrentSlug || subdomain;
    const currentSlugLower = currentSlug.toLowerCase();
    const retiredHostSlug = subdomain.toLowerCase();
    const url = request.nextUrl.clone();

    for (const param of MERCHANT_SLUG_QUERY_PARAMS) {
      const value = url.searchParams.get(param)?.toLowerCase();
      if (!value || value === currentSlugLower) {
        continue;
      }

      const aliasCurrentSlug =
        hostAliasCurrentSlug && value === retiredHostSlug
          ? hostAliasCurrentSlug
          : await getCurrentSlugForAlias(value);

      if (aliasCurrentSlug?.toLowerCase() === currentSlugLower) {
        url.searchParams.set(param, currentSlug);
      }
    }

    if (url.search !== request.nextUrl.search) {
      rewrittenApiUrl = url;
    }
  }

  const response = rewrittenApiUrl
    ? NextResponse.rewrite(rewrittenApiUrl, {
        request: { headers: requestHeaders },
      })
    : NextResponse.next({ request: { headers: requestHeaders } });

  const { pathname } = request.nextUrl;
  return applySecurityHeaders(
    response,
    pathname,
    userAgent,
    getRouteType(pathname),
    isLocalhost(hostname),
    undefined,
    request,
    hostname
  );
}

/**
 * True when `pathname` has the retired-alias-prefixed API SHAPE (`/<prefix>/api/...`)
 * on a host that could rewrite it — i.e. the root domain or a custom domain, NOT a
 * merchant subdomain (where the same path is a storefront page, never rewritten). The
 * API rate limiter keys off this SYNC check so it runs before the DB-hitting alias
 * confirmation; without it, rotating the first path segment could force un-rate-limited
 * getCurrentSlugForAlias lookups.
 */
function isAliasApiShapedOnRewritableHost(
  hostname: string | undefined,
  shape: { apiPathname: string; prefix: string } | null
): boolean {
  if (!shape) {
    return false;
  }
  const subdomain = hostname ? extractSubdomain(hostname, ROOT_DOMAIN) : null;
  const isOnMerchantSubdomain =
    subdomain !== null && !RESERVED_SUBDOMAINS.has(subdomain);
  return !isOnMerchantSubdomain;
}

/**
 * Safely check if hostname is a subdomain of a given parent domain
 * This prevents attacks like "evilusebaci.com" matching "usebaci.com"
 */
function extractSubdomain(
  hostname: string,
  parentDomain: string
): string | null {
  const normalizedHost = normalizeHostname(hostname);
  const normalizedParent = parentDomain.toLowerCase();
  const expectedSuffix = `.${normalizedParent}`;

  // Must end with .parentdomain exactly
  if (!normalizedHost.endsWith(expectedSuffix)) {
    return null;
  }

  // Extract subdomain part
  const subdomain = normalizedHost.slice(0, -expectedSuffix.length);

  // Validate: not empty, no dots (no nested subdomains), valid DNS characters
  if (!subdomain || subdomain.includes('.') || !isValidSubdomain(subdomain)) {
    return null;
  }

  return subdomain;
}

/**
 * Check if hostname exactly matches our root domain (with optional www)
 */
function isRootDomain(hostname: string, rootDomain: string): boolean {
  const normalizedHost = normalizeHostname(hostname);
  const normalizedRoot = rootDomain.toLowerCase();

  return (
    normalizedHost === normalizedRoot ||
    normalizedHost === `www.${normalizedRoot}` ||
    // Explicitly allow usebaci.com (platform domain) to handle legacy access
    normalizedHost === 'usebaci.com' ||
    normalizedHost === 'www.usebaci.com'
  );
}

/**
 * Check if hostname is a Vercel preview deployment
 * Validates exact structure: {hash}-{project}-{team}.vercel.app
 */
function isVercelPreview(hostname: string): boolean {
  const normalizedHost = normalizeHostname(hostname);

  // Must end with exactly .vercel.app
  if (!normalizedHost.endsWith('.vercel.app')) {
    return false;
  }

  // Extract the subdomain part before .vercel.app
  const vercelSubdomain = normalizedHost.slice(0, -'.vercel.app'.length);

  // Vercel subdomains are alphanumeric with hyphens, typically contain project identifiers
  // Reject if empty or contains dots (nested subdomains)
  if (!vercelSubdomain || vercelSubdomain.includes('.')) {
    return false;
  }

  return isValidSubdomain(vercelSubdomain);
}

/**
 * Check if this is localhost/development environment (with or without subdomain)
 */
function isLocalhost(hostname: string): boolean {
  const normalizedHost = normalizeHostname(hostname);

  // Standard localhost/loopback
  if (
    normalizedHost === 'localhost' ||
    normalizedHost === '127.0.0.1' ||
    normalizedHost.endsWith('.localhost')
  ) {
    return true;
  }

  // Allow private/local IP ranges ONLY in development (for physical devices testing over WiFi)
  if (process.env.NODE_ENV === 'development') {
    // 192.168.x.x
    if (normalizedHost.startsWith('192.168.')) return true;
    // 10.x.x.x
    if (normalizedHost.startsWith('10.')) return true;
    // 172.16.x.x to 172.31.x.x
    const match172 = normalizedHost.match(/^172\.(1[6-9]|2[0-9]|3[01])\./);
    if (match172) return true;
  }

  return false;
}

/**
 * Resolve the stable tenant identity available from the public request shape.
 * Platform storefronts share a slug tag across root-path, subdomain, and
 * preview aliases. Custom domains use their hostname so legacy null-slug rows
 * remain independently evictable without another lookup in the header path.
 */
function getStorefrontPublicationResponseCacheTag(
  pathname: string,
  hostname: string | undefined
): string | null {
  if (!hostname || isLocalhost(hostname)) {
    return null;
  }

  const normalizedHostname = normalizeHostname(hostname);
  if (isPlatformHost(normalizedHostname)) {
    const slug = safeDecodeSegment(
      pathname.split('/').filter(Boolean)[0]
    ).toLowerCase();
    if (
      !slug ||
      !isValidSubdomain(slug) ||
      RESERVED_SUBDOMAINS.has(slug) ||
      PLATFORM_ROOT_ROUTE_SEGMENTS.has(slug)
    ) {
      return null;
    }

    return getStorefrontPublicationCacheTag({ kind: 'slug', value: slug });
  }

  const merchantSubdomain = extractSubdomain(normalizedHostname, ROOT_DOMAIN);
  if (merchantSubdomain && !RESERVED_SUBDOMAINS.has(merchantSubdomain)) {
    return getStorefrontPublicationCacheTag({
      kind: 'slug',
      value: merchantSubdomain,
    });
  }

  return isValidCustomDomain(normalizedHostname)
    ? getStorefrontPublicationCacheTag({
        kind: 'hostname',
        value: normalizedHostname,
      })
    : null;
}

/**
 * Extract subdomain from localhost for development testing
 * e.g., ogabassey.localhost:3000 -> ogabassey
 */
function extractLocalhostSubdomain(hostname: string): string | null {
  const normalizedHost = normalizeHostname(hostname);

  if (normalizedHost === 'localhost' || normalizedHost === '127.0.0.1') {
    return null; // Plain localhost - no subdomain
  }

  if (normalizedHost.endsWith('.localhost')) {
    const subdomain = normalizedHost.slice(0, -'.localhost'.length);
    if (subdomain && !subdomain.includes('.') && isValidSubdomain(subdomain)) {
      return subdomain;
    }
  }

  return null;
}

/**
 * Validate custom domain format (basic validation)
 * Must be a valid-looking domain, not an IP, not containing suspicious patterns
 */
function isValidCustomDomain(hostname: string): boolean {
  const normalizedHost = normalizeHostname(hostname);

  // Must have at least one dot (domain.tld)
  if (!normalizedHost.includes('.')) return false;

  // No IP addresses
  if (/^\d+\.\d+\.\d+\.\d+$/.test(normalizedHost)) return false;

  // Basic domain validation: alphanumeric, hyphens, dots
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(normalizedHost)) return false;

  // No consecutive dots
  if (normalizedHost.includes('..')) return false;

  return true;
}

const STOREFRONT_DOCUMENT_HOME_PATH_RULES: StorefrontDocumentHomePathRules = {
  isSlugPrefixedHost: isPlatformHost,
  extractMerchantSubdomain: (hostname) =>
    extractSubdomain(hostname, ROOT_DOMAIN),
  extractLocalhostSubdomain,
  isValidCustomDomain,
  isValidMerchantSlug: isValidSubdomain,
  reservedSubdomains: RESERVED_SUBDOMAINS,
  platformRootRouteSegments: PLATFORM_ROOT_ROUTE_SEGMENTS,
};

/**
 * Classify route type for selective security policies
 * - Admin routes: Dashboard, builder, onboarding (strict CSP with nonce)
 * - Auth routes: Login, signup, password reset (strict CSP with nonce)
 * - Storefront routes: Public merchant pages (relaxed CSP for ISR/SSG)
 * - API routes: Backend endpoints (basic CSP)
 */
function getRouteType(
  pathname: string
): 'admin' | 'auth' | 'storefront' | 'api' {
  if (
    pathname.startsWith('/admin') ||
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/builder') ||
    pathname.startsWith('/onboarding')
  ) {
    return 'admin';
  }

  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/reset-password')
  ) {
    return 'auth';
  }

  if (pathname.startsWith('/api')) {
    return 'api';
  }

  return 'storefront';
}

function buildMerchantFeedPassThroughResponse({
  request,
  pathname,
  userAgent,
  hostname,
  customDomain,
  merchantSlug,
}: {
  request: NextRequest;
  pathname: string;
  userAgent: string;
  hostname: string;
  customDomain?: string;
  merchantSlug?: string | null;
}): NextResponse {
  const feedHeaders = buildProxyRequestHeaders(request);

  if (customDomain) {
    feedHeaders.set('x-custom-domain', customDomain);
    feedHeaders.set('x-merchant-domain', customDomain);
  }
  if (merchantSlug) {
    feedHeaders.set('x-merchant-slug', merchantSlug);
  }

  const response = NextResponse.next({
    request: {
      headers: feedHeaders,
    },
  });

  // Public machine-readable storefront contracts use the storefront security
  // profile: relaxed CSP is appropriate for storefront-scoped JSON/XML content.
  const routeType = getRouteType(pathname);
  const isLocal = isLocalhost(hostname);
  return applySecurityHeaders(
    response,
    pathname,
    userAgent,
    routeType,
    isLocal,
    undefined,
    request,
    hostname
  );
}

function buildStorefrontRootSitemapRewriteResponse({
  request,
  pathname,
  userAgent,
  hostname,
  routeIdentifier,
  customDomain,
  merchantSlug,
}: {
  request: NextRequest;
  pathname: string;
  userAgent: string;
  hostname: string;
  routeIdentifier: string;
  customDomain?: string;
  merchantSlug?: string | null;
}): NextResponse {
  const sitemapUrl = request.nextUrl.clone();
  sitemapUrl.pathname = `/${routeIdentifier}${STOREFRONT_ROOT_SITEMAP_REWRITE_PATH}`;

  const sitemapHeaders = buildProxyRequestHeaders(request);
  if (customDomain) {
    sitemapHeaders.set('x-custom-domain', customDomain);
    sitemapHeaders.set('x-merchant-domain', customDomain);
  }
  if (merchantSlug) {
    sitemapHeaders.set('x-merchant-slug', merchantSlug);
  }

  const response = NextResponse.rewrite(sitemapUrl, {
    request: {
      headers: sitemapHeaders,
    },
  });

  return applySecurityHeaders(
    response,
    pathname,
    userAgent,
    'storefront',
    isLocalhost(hostname),
    undefined,
    request,
    hostname
  );
}

function buildStorefrontFaviconRewriteResponse({
  request,
  pathname,
  userAgent,
  hostname,
  routeIdentifier,
  customDomain,
  merchantSlug,
}: {
  request: NextRequest;
  pathname: string;
  userAgent: string;
  hostname: string;
  routeIdentifier: string;
  customDomain?: string;
  merchantSlug?: string | null;
}): NextResponse {
  const faviconUrl = request.nextUrl.clone();
  faviconUrl.pathname = `/${routeIdentifier}/favicon.ico`;

  const faviconHeaders = buildProxyRequestHeaders(request);
  if (customDomain) {
    faviconHeaders.set('x-custom-domain', customDomain);
    faviconHeaders.set('x-merchant-domain', customDomain);
  }
  if (merchantSlug) {
    faviconHeaders.set('x-merchant-slug', merchantSlug);
  }

  const response = NextResponse.rewrite(faviconUrl, {
    request: {
      headers: faviconHeaders,
    },
  });

  return applySecurityHeaders(
    response,
    pathname,
    userAgent,
    'storefront',
    isLocalhost(hostname),
    undefined,
    request,
    hostname
  );
}

/**
 * Generate Content Security Policy based on route type
 * Multi-tenant strategy:
 * - Admin/Auth: Nonce-based CSP (strict, requires SSR)
 * - Storefront: Relaxed CSP (allows ISR/SSG caching)
 */
function generateCSP(
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

function generateCspNonce(): string {
  try {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return encodeCspNonce(String.fromCharCode(...bytes));
  } catch {
    return encodeCspNonce(crypto.randomUUID());
  }
}

function encodeCspNonce(value: string): string {
  return btoa(value)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function shouldForwardStrictCspNonce(
  routeType: 'admin' | 'auth' | 'storefront' | 'api'
): routeType is 'admin' | 'auth' {
  return routeType === 'admin' || routeType === 'auth';
}

/**
 * Build a real hard-status (404/410) storefront HTML response (PR-B §3.2).
 *
 * Under PPR a page-level `notFound()` only yields a soft-404 (200 + noindex)
 * because the static shell has already committed 200. Returning this from the
 * proxy gives crawlers a true status code. The body is minimal but valid HTML
 * (noindex), with full CSP/security headers applied and `Cache-Control:
 * no-store` set LAST so the cache section inside `applySecurityHeaders` can
 * never edge-cache a transient hard status.
 */
function buildHardStatusStorefrontResponse(
  status: 404 | 410,
  request: NextRequest,
  pathname: string,
  userAgent: string,
  hostname: string | undefined,
  homePath = '/'
): NextResponse {
  const title = status === 410 ? 'Page gone' : 'Page not found';
  const safeHomePath = HARD_STATUS_HOME_PATH_PATTERN.test(homePath)
    ? homePath
    : '/';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="robots" content="noindex, follow"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${title}</title></head><body style="font-family:system-ui,-apple-system,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center"><main><h1>${title}</h1><p>The page you’re looking for isn’t here. <a href="${safeHomePath}">Go to the homepage</a>.</p></main></body></html>`;

  // HEAD must not carry a body (RFC 9110 §9.3.2); the noindex signal travels in
  // the X-Robots-Tag header below so a HEAD crawl still sees it.
  const body = request.method === 'HEAD' ? null : html;
  const response = new NextResponse(body, { status });
  response.headers.set('Content-Type', 'text/html; charset=utf-8');
  applySecurityHeaders(
    response,
    pathname,
    userAgent,
    'storefront',
    isLocalhost(hostname ?? ''),
    undefined,
    request,
    hostname
  );
  // Header-level noindex (belt-and-suspenders with the body <meta>): crawlers
  // that only HEAD, or don't parse the body, still get the directive.
  response.headers.set('X-Robots-Tag', 'noindex, follow');
  // Clear every split CDN header LAST: the cache section runs inside
  // applySecurityHeaders and would otherwise mark a product-shaped path
  // cacheable, edge-caching a false 404/410 at the highest-precedence layer.
  applyStorefrontDocumentCacheHeaders(response, 'non-cacheable', null);
  response.headers.set('Cache-Control', PDP_HTML_CACHE_CONTROL);
  return response;
}

/**
 * Hard-reject deterministic malformed PDP paths before custom-domain, product,
 * or cached-storefront lookups. A bounded safety verdict is intentionally much
 * narrower than a generic URL validator: normal percent-encoded slugs and all
 * non-PDP routes retain their existing routing behavior.
 */
function resolveUnsafeStorefrontPdpPath(
  request: NextRequest,
  pathname: string,
  hostname: string | undefined,
  userAgent: string
): NextResponse | null {
  if (!isStorefrontDocumentNavigation(request.method, request.headers)) {
    return null;
  }

  // Imported smart punctuation has a safe, one-hop ASCII canonicalization.
  // Judge that recoverable form so the later 308 remains available, while
  // keeping the raw path for any terminal hard-404 response.
  const safetyPathname =
    normalizeCacheSafeStorefrontPathname(new URL(request.url).pathname) ??
    pathname;
  const routeType = getRouteType(safetyPathname);
  if (routeType !== 'storefront') {
    return null;
  }

  const homePath = getStorefrontDocumentHomePath(
    safetyPathname,
    hostname,
    STOREFRONT_DOCUMENT_HOME_PATH_RULES
  );
  if (!homePath) {
    return null;
  }

  const contentSegments = getStorefrontContentSegments(
    safetyPathname,
    hostname,
    routeType
  );
  if (
    !hasUnsafeStorefrontPdpSegments(
      contentSegments,
      NON_CACHEABLE_STOREFRONT_FIRST_SEGMENTS
    )
  ) {
    return null;
  }

  return buildHardStatusStorefrontResponse(
    404,
    request,
    pathname,
    userAgent,
    hostname,
    homePath
  );
}

/**
 * Crawl-budget pre-React status for storefront PDP product slugs (PR-B §3.2).
 *
 * Gated tightly to clean, non-prefetch, GET/HEAD HTML navigations to a
 * 2-segment PDP path (`/{category}/{productSlug}`). It asks the internal
 * slug-set route whether the product slug is active, redirectable legacy, or
 * absent. Redirectable archived aliases get a real 308 before the PDP route can
 * stream a 200; positively absent slugs get a hard 404. Every uncertain path
 * (params, RSC/prefetch, non-PDP shape, reserved segment, unavailable/empty
 * slug set) falls through — fail-open, so a live product is never 404'd.
 */
async function resolveStorefrontPdpHardNotFound(
  request: NextRequest,
  pathname: string,
  hostname: string | undefined,
  userAgent: string,
  identifier: string
): Promise<NextResponse | null> {
  if (!isStorefrontDocumentNavigation(request.method, request.headers)) {
    return null;
  }
  // Param URLs should not become hard 404s, but redirectable legacy aliases
  // should still canonicalize while preserving attribution/search params.
  const hasSearchParams = request.nextUrl.search.length > 0;

  const routeType = getRouteType(pathname);
  if (routeType !== 'storefront') {
    return null;
  }

  // Only the exact 2-segment PDP shape; category listings, nested subroutes
  // (compare/best-under), and reserved segments fall through.
  const contentSegments = getStorefrontContentSegments(
    pathname,
    hostname,
    routeType
  );
  if (contentSegments.length !== 2) {
    return null;
  }
  // Path segments arrive percent-encoded (e.g. `dell-%E2%80%93-xps`); the DB
  // slug is decoded, so we MUST decode before comparing membership/reserved —
  // otherwise an encoded-but-real slug looks absent and gets falsely 404ed.
  const firstSegmentGate = getStorefrontPdpFirstSegmentGate(
    contentSegments,
    NON_CACHEABLE_STOREFRONT_FIRST_SEGMENTS
  );
  const { firstSegment, isNonPdpFirstSegment, isProductsFallbackPdp } =
    firstSegmentGate;
  const productSlug = safeDecodeSegment(contentSegments[1]);
  // `/products/{slug}` (plural) is the categoryless PDP fallback that
  // getProductUrl emits and the `(pdp)/products/[productSlug]` route serves — a
  // real PDP surface, so it MUST be checked even though `products` is a reserved
  // first segment. (The singular `/product/{slug}` is a legacy redirect, not a
  // PDP, so it stays excluded below.)
  // Otherwise the first segment must be a real category — non-PDP first segments
  // (blog, account, my-account, receipts, pages, cart, checkout, …) have their
  // own App Router pages (incl. `/my-account/[...path]` catch-alls) and must
  // never be hard-404ed. Use the BROADER non-cacheable first-segment set, not
  // just RESERVED, so authenticated route groups are excluded too.
  if (isNonPdpFirstSegment) {
    return null;
  }
  if (
    !productSlug ||
    RESERVED_STOREFRONT_SEGMENTS.has(productSlug.toLowerCase())
  ) {
    return null;
  }
  // `/{category}/compare` is the category compare hub route, not a PDP — it
  // must never be resolved (and hard-404ed) as a product slug. The categoryless
  // `/products/{slug}` fallback stays checked: `products` beats the dynamic
  // `[category]` segment in route precedence, so `/products/compare` has no hub
  // route and `compare` there can only be a genuine product slug.
  //
  // Confirmed-EMPTY hubs (anti-thin-page guard) get the same hard 404 as
  // missing PDPs: the page's own thin-hub notFound() only yields a PPR
  // soft-404 (200 + noindex shell). The verdict is the page's own criterion
  // served by /api/internal/compare-hub-status, fails open on any uncertainty,
  // and is skipped for param URLs — mirroring the PDP hasSearchParams rule —
  // so a hub that gains eligible products serves 200 on the next clean crawl.
  if (
    !isProductsFallbackPdp &&
    CATEGORY_LISTING_HUB_SEGMENTS.has(productSlug.toLowerCase())
  ) {
    if (hasSearchParams) {
      return null;
    }
    const hubStatus = await resolveStorefrontCompareHubStatus({
      origin: request.nextUrl.origin,
      identifier,
      categorySlug: firstSegment,
      secret: getInternalApiSecret(),
    });
    if (hubStatus.kind !== 'empty') {
      return null;
    }
    return buildHardStatusStorefrontResponse(
      404,
      request,
      pathname,
      userAgent,
      hostname
    );
  }
  // UUID product URLs (`/{category}/{productId}`) resolve through the page's
  // id-based lookup + canonical 308; the slug set only holds slugs, so a
  // UUID-shaped segment must never be hard-404ed.
  if (UUID_SHAPED_SLUG.test(productSlug)) {
    return null;
  }

  const resolution = await resolveStorefrontProductSlugResolution({
    origin: request.nextUrl.origin,
    identifier,
    productSlug,
    secret: getInternalApiSecret(),
  });

  if (resolution.kind === 'redirect') {
    const redirectUrl = request.nextUrl.clone();
    const redirectPath = isSlugPrefixedStorefrontRequest(hostname)
      ? `/${identifier}${resolution.redirectPath}`
      : resolution.redirectPath;
    redirectUrl.pathname = redirectPath;
    return NextResponse.redirect(redirectUrl, 308);
  }

  if (resolution.kind !== 'missing' || hasSearchParams) {
    return null;
  }

  return buildHardStatusStorefrontResponse(
    404,
    request,
    pathname,
    userAgent,
    hostname
  );
}

/**
 * Canonical PDP redirect for stale category aliases and archived variant slugs.
 *
 * This runs in proxy before the App Router/PPR page streams. Relying on
 * `permanentRedirect()` inside the streamed product route can produce a 200
 * noindex shell that only changes after JS/rendering in Semrush/Google-style
 * crawls. The internal endpoint performs the DB/cache lookup behind the
 * platform host and fails open on uncertainty.
 */
interface StorefrontPdpCanonicalRedirectResolution {
  response: NextResponse | null;
  skipHardNotFound: boolean;
}

async function resolveStorefrontPdpCanonicalRedirect(
  request: NextRequest,
  pathname: string,
  hostname: string | undefined,
  identifier: string,
  publicPathPrefix = ''
): Promise<StorefrontPdpCanonicalRedirectResolution> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return { response: null, skipHardNotFound: false };
  }
  if (
    request.headers.get('rsc') === '1' ||
    request.headers.has('next-router-prefetch') ||
    request.headers.has('next-router-state-tree')
  ) {
    return { response: null, skipHardNotFound: false };
  }
  const fetchDest = request.headers.get('sec-fetch-dest')?.toLowerCase();
  if (fetchDest && fetchDest !== 'document') {
    return { response: null, skipHardNotFound: false };
  }

  const routeType = getRouteType(pathname);
  if (routeType !== 'storefront') {
    return { response: null, skipHardNotFound: false };
  }

  const contentSegments = getStorefrontContentSegments(
    pathname,
    hostname,
    routeType
  );
  if (contentSegments.length !== 2) {
    return { response: null, skipHardNotFound: false };
  }

  const firstSegment = safeDecodeSegment(contentSegments[0]).toLowerCase();
  const productSlug = safeDecodeSegment(contentSegments[1]);
  const isProductsFallbackPdp = firstSegment === 'products';

  if (
    !isProductsFallbackPdp &&
    (!firstSegment || NON_CACHEABLE_STOREFRONT_FIRST_SEGMENTS.has(firstSegment))
  ) {
    return { response: null, skipHardNotFound: false };
  }
  if (
    !productSlug ||
    RESERVED_STOREFRONT_SEGMENTS.has(productSlug.toLowerCase())
  ) {
    return { response: null, skipHardNotFound: false };
  }
  // `/{category}/compare` is the category compare hub route, not a PDP — never
  // spend a canonical-alias lookup on it (a stale alias literally slugged
  // "compare" must not 308 the live hub away either). The categoryless
  // `/products/{slug}` fallback stays checked, mirroring the hard-404 gate.
  if (
    !isProductsFallbackPdp &&
    CATEGORY_LISTING_HUB_SEGMENTS.has(productSlug.toLowerCase())
  ) {
    return { response: null, skipHardNotFound: false };
  }
  const canonicalResult = await getStorefrontProductCanonicalRedirectResult({
    origin: request.nextUrl.origin,
    identifier,
    category: firstSegment,
    productSlug,
    secret: getInternalApiSecret(),
  });

  if (canonicalResult.kind === 'unknown') {
    return { response: null, skipHardNotFound: false };
  }

  if (canonicalResult.kind === 'checked-no-redirect') {
    return { response: null, skipHardNotFound: true };
  }

  const publicTargetPath = `${publicPathPrefix}${canonicalResult.redirectPath}`;
  if (
    normalizePathnameForCompare(publicTargetPath) ===
    normalizePathnameForCompare(pathname)
  ) {
    return { response: null, skipHardNotFound: true };
  }

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = publicTargetPath;
  return {
    response: NextResponse.redirect(redirectUrl, 308),
    skipHardNotFound: true,
  };
}

// Shared eligibility gate for the hard-status preflights (blog post + blog
// listing): only real GET/HEAD document navigations to storefront routes are
// preflighted — never RSC/prefetch/subresource requests or draft-mode.
function isEligibleForHardStatusPreflight(
  request: NextRequest,
  pathname: string
): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return false;
  }
  if (
    request.headers.get('rsc') === '1' ||
    request.headers.has('next-router-prefetch') ||
    request.headers.has('next-router-state-tree')
  ) {
    return false;
  }
  const fetchDest = request.headers.get('sec-fetch-dest')?.toLowerCase();
  if (fetchDest && fetchDest !== 'document') {
    return false;
  }
  if (
    DRAFT_MODE_COOKIE_NAMES.some((cookieName) =>
      request.cookies.has(cookieName)
    )
  ) {
    return false;
  }
  return getRouteType(pathname) === 'storefront';
}

async function resolveStorefrontBlogPostHardStatus(
  request: NextRequest,
  pathname: string,
  hostname: string | undefined,
  userAgent: string,
  identifier: string,
  publicPathPrefix = ''
): Promise<NextResponse | null> {
  if (!isEligibleForHardStatusPreflight(request, pathname)) {
    return null;
  }

  const routeType = getRouteType(pathname);
  const contentSegments = getStorefrontContentSegments(
    pathname,
    hostname,
    routeType
  );
  if (contentSegments.length !== 2) {
    return null;
  }

  const firstSegment = safeDecodeSegment(contentSegments[0]).toLowerCase();
  const postSlug = safeDecodeSegment(contentSegments[1]);
  const normalizedPostSlug = postSlug.toLowerCase();
  if (
    firstSegment !== 'blog' ||
    !postSlug ||
    BLOG_STATUS_PREFLIGHT_EXCLUDED_SLUGS.has(normalizedPostSlug)
  ) {
    return null;
  }

  const resolution = await resolveStorefrontBlogPostStatus({
    origin: request.nextUrl.origin,
    identifier,
    postSlug,
    secret: getInternalApiSecret(),
  });

  if (resolution.kind === 'redirect') {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = `${publicPathPrefix}${resolution.redirectPath}`;
    return NextResponse.redirect(redirectUrl, 308);
  }

  if (resolution.kind !== 'missing') {
    return null;
  }

  return buildHardStatusStorefrontResponse(
    404,
    request,
    pathname,
    userAgent,
    hostname,
    publicPathPrefix || '/'
  );
}

const resolveStorefrontComparePageHardStatus =
  createStorefrontComparePageHardStatusResolver({
    isEligibleForHardStatusPreflight,
    getRouteType,
    getStorefrontContentSegments,
    nonCacheableStorefrontFirstSegments:
      NON_CACHEABLE_STOREFRONT_FIRST_SEGMENTS,
    buildHardStatusStorefrontResponse,
  });

// Mirror the route's parseBlogListingPage cap so the preflight never issues a
// larger Supabase offset than the route itself would.
const MAX_BLOG_LISTING_PAGE = 10_000;

function parseBlogListingPageParam(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return Math.min(parsed, MAX_BLOG_LISTING_PAGE);
}

function buildBlogListingIntent(
  contentSegments: string[],
  searchParams: URLSearchParams
): BlogListingStatusIntent | null {
  if (
    !contentSegments.length ||
    safeDecodeSegment(contentSegments[0]).toLowerCase() !== 'blog'
  ) {
    return null;
  }

  const category = searchParams.get('category')?.trim() || undefined;
  // Search variants of the listing/category routes stay noindex and are left
  // for the route to render — a hard redirect that rebuilds/drops the search
  // term would be wrong. The author route ignores ?search=, so its hard-status
  // checks still run (handled per-branch below).
  const hasSearch = Boolean(searchParams.get('search')?.trim());
  const page = parseBlogListingPageParam(searchParams.get('page'));

  if (contentSegments.length === 1) {
    if (hasSearch) {
      return null;
    }
    // /blog — canonicalize a known ?category= (page 1), else clamp out-of-range
    // ?page= (the category, when present, stays on the query URL).
    if (category && (page ?? 1) === 1) {
      return { kind: 'category-query', category };
    }
    if (page && page > 1) {
      return { kind: 'listing-page', page, ...(category ? { category } : {}) };
    }
    return null;
  }

  if (contentSegments.length === 3) {
    const second = safeDecodeSegment(contentSegments[1]).toLowerCase();
    const third = safeDecodeSegment(contentSegments[2]);
    if (second === 'category' && third && !hasSearch && page && page > 1) {
      return { kind: 'category-page', categorySlug: third, page };
    }
    if (second === 'author' && third) {
      // Author pages ignore ?search=, so the no-posts 404 / page clamp still
      // runs even with a stray search param.
      return { kind: 'author', authorSlug: third, page: page ?? 1 };
    }
  }

  return null;
}

async function resolveStorefrontBlogListingHardStatus(
  request: NextRequest,
  pathname: string,
  hostname: string | undefined,
  userAgent: string,
  identifier: string,
  publicPathPrefix = ''
): Promise<NextResponse | null> {
  if (!isEligibleForHardStatusPreflight(request, pathname)) {
    return null;
  }

  const routeType = getRouteType(pathname);
  const contentSegments = getStorefrontContentSegments(
    pathname,
    hostname,
    routeType
  );
  const intent = buildBlogListingIntent(
    contentSegments,
    request.nextUrl.searchParams
  );
  if (!intent) {
    return null;
  }

  const resolution = await resolveStorefrontBlogListingStatus({
    origin: request.nextUrl.origin,
    identifier,
    intent,
    secret: getInternalApiSecret(),
  });

  if (resolution.kind === 'redirect') {
    // redirectPath may carry its own query (e.g. /blog?page=3); split it so the
    // originating ?category=/?page= filters are replaced, not appended.
    const target = new URL(resolution.redirectPath, request.nextUrl.origin);
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = `${publicPathPrefix}${target.pathname}`;
    redirectUrl.search = target.search;
    // Preserve non-filter params (utm_*, ref, tag=a&tag=b, ...) that the
    // resolver target drops — matching the in-route param-preservation rule,
    // including repeated (array) values. Only the target's own keys are kept.
    const targetKeys = new Set(redirectUrl.searchParams.keys());
    for (const [key, value] of request.nextUrl.searchParams) {
      if (
        key !== 'category' &&
        key !== 'page' &&
        key !== 'search' &&
        !targetKeys.has(key)
      ) {
        redirectUrl.searchParams.append(key, value);
      }
    }
    return NextResponse.redirect(redirectUrl, resolution.status);
  }

  if (resolution.kind === 'notFound') {
    return buildHardStatusStorefrontResponse(
      404,
      request,
      pathname,
      userAgent,
      hostname,
      publicPathPrefix || '/'
    );
  }

  return null;
}

function buildStrictCspResponse(
  request: NextRequest,
  routeType: 'admin' | 'auth',
  isLocal: boolean
): { nonce: string; response: NextResponse } {
  const nonce = generateCspNonce();
  const csp = generateCSP(routeType, isLocal, nonce);
  const requestHeaders = new Headers(request.headers);
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

function buildPostHogRelayPassThroughResponse(
  request: NextRequest,
  pathname: string,
  userAgent: string,
  hostname: string
): NextResponse {
  const requestHeaders = buildPostHogRelayRequestHeaders(request);
  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  return applySecurityHeaders(
    response,
    pathname,
    userAgent,
    'api',
    isLocalhost(hostname),
    undefined,
    request,
    hostname
  );
}

/**
 * Convert a `.md` pathname into the corresponding `/api/llm/` path.
 *
 * Examples (with slug "ogabassey"):
 *   /index.html.md        → /api/llm/ogabassey
 *   /about.md             → /api/llm/ogabassey/about
 *   /shoes/index.html.md  → /api/llm/ogabassey/shoes
 *   /shoes/nike-air.md    → /api/llm/ogabassey/shoes/nike-air
 *   /blog/my-post.md      → /api/llm/ogabassey/blog/my-post
 */
function toLlmApiPath(pathname: string, slug: string): string {
  // Strip trailing /index.html.md or .md suffix to get the clean path
  let clean = pathname;
  if (clean.endsWith('/index.html.md')) {
    clean = clean.slice(0, -'/index.html.md'.length);
  } else if (clean.endsWith('.md')) {
    clean = clean.slice(0, -'.md'.length);
  }

  // Remove leading slash
  clean = clean.replace(/^\//, '');

  // Build the API path
  return clean ? `/api/llm/${slug}/${clean}` : `/api/llm/${slug}`;
}

/**
 * If `oldSlug` is a retired storefront slug (the merchant renamed via the
 * "Change store URL" flow), return the absolute URL to 301 to — the current
 * slug's custom domain if it has one, otherwise its `<slug>.usebaci.com`
 * subdomain — with `restPath` + `search` appended. Returns null when it isn't a
 * retired alias.
 *
 * Only safe/idempotent methods redirect: a 301 on POST/PUT/etc. lets clients
 * replay as GET, dropping the body and breaking non-idempotent flows (checkout,
 * order creation) that a stale client may fire at the just-retired host. The
 * method guard lives here so every call site inherits it.
 */
async function resolveRetiredSlugRedirect(
  oldSlug: string,
  restPath: string,
  search: string,
  method: string
): Promise<string | null> {
  if (method !== 'GET' && method !== 'HEAD') {
    return null;
  }
  const currentSlug = await getCurrentSlugForAlias(oldSlug);
  if (!currentSlug || currentSlug === oldSlug) {
    return null;
  }
  const renamedCustomDomain = await getCustomDomainForSlug(currentSlug);
  const destinationHost =
    renamedCustomDomain ?? `${currentSlug}.${ROOT_DOMAIN}`;
  return `https://${destinationHost}${restPath}${search}`;
}

/**
 * Next.js Middleware Function
 * Handles multi-tenant routing, security headers, caching, and authentication
 */
export async function proxy(request: NextRequest) {
  const hostname = request.headers.get('host') || '';
  const userAgent = request.headers.get('user-agent') || '';
  const pathname = request.nextUrl.pathname;

  if (isStaticAssetOutsidePostHogRelay(pathname)) {
    return NextResponse.next();
  }

  // ==== POSTHOG RELAY PASSTHROUGH ====
  // Let Next.js beforeFiles rewrites proxy PostHog ingest/assets on the same
  // merchant origin before URL canonicalization can redirect relay calls.
  if (isPostHogRelayPath(pathname)) {
    return buildPostHogRelayPassThroughResponse(
      request,
      pathname,
      userAgent,
      hostname
    );
  }

  // ==== URL NORMALIZATION: STATIC PREFIXES FIRST ====
  // Lowercase only prefixes that are EXCLUSIVELY non-storefront and/or have
  // case-sensitive tail segments. This MUST run before API rate limiting so
  // /API/... doesn't bypass the /api branch.
  for (const prefix of CASE_PRESERVING_PREFIXES) {
    const normalized = normalizeLeadingPrefix(pathname, prefix);
    if (normalized) {
      return NextResponse.redirect(
        new URL(normalized + request.nextUrl.search, request.url),
        308
      );
    }
  }

  const isLegacyAnalyticsConversionPost =
    isLegacyAnalyticsConversionPath(pathname) && request.method === 'POST';
  const isLegacyKlumpWebhook = isLegacyKlumpWooCommerceWebhookPath(pathname);
  // A `/<oldSlug>/api/...` request is rewritten to `/api/...` by the custom-domain /
  // root-path branches below, so the API security guard must evaluate that EFFECTIVE
  // /api path or the rewrite would slip past it. Detect the SHAPE synchronously (no
  // DB) so the rate limiter runs BEFORE the alias confirmation; the confirmation (a DB
  // lookup) is deferred until after rate limiting, and body-size/CSRF apply only once
  // the alias is confirmed — so a storefront page that merely has `api` as a second
  // segment is neither rate-limit-bypassed nor wrongly treated as an API mutation.
  const aliasApiShape = matchAliasApiPrefixShape(pathname);
  const isAliasApiShaped = isAliasApiShapedOnRewritableHost(
    hostname,
    aliasApiShape
  );
  // Pathname the RATE LIMITER keys off — the effective /api path for the alias SHAPE.
  const apiRateLimitPathname = isLegacyKlumpWebhook
    ? KLUMP_WEBHOOK_API_PATH
    : isLegacyAnalyticsConversionPost
      ? ANALYTICS_CONVERSION_API_PATH
      : isAliasApiShaped && aliasApiShape
        ? aliasApiShape.apiPathname
        : pathname;

  // The blog.ogabassey.com migration branch below owns every request to that
  // host and does its own trailing-slash normalization, so exempt it here.
  // Otherwise a trailing-slash WordPress permalink (the common form, e.g.
  // /2025/04/14/slug/) would take this 308 first and only reach the dated
  // collapse on a second hop.
  const noTrailingSlashPathname =
    isLegacyKlumpWebhook ||
    isLegacyAnalyticsConversionPost ||
    normalizeHostname(hostname) === 'blog.ogabassey.com'
      ? null
      : getNoTrailingSlashRedirectPath(pathname);
  if (noTrailingSlashPathname) {
    return NextResponse.redirect(
      new URL(noTrailingSlashPathname + request.nextUrl.search, request.url),
      308
    );
  }

  // ==== RATE LIMITING (API Routes) ====
  // Runs on the SHAPE (apiRateLimitPathname), BEFORE the alias DB confirmation, so a
  // client rotating the first path segment (`/<random>/api/...`) can't force
  // un-rate-limited getCurrentSlugForAlias lookups. Protect API endpoints from abuse.
  if (apiRateLimitPathname.startsWith('/api')) {
    // Internal, Bearer-authed self-calls (e.g. the proxy's own slug-set lookup
    // for the crawl-budget hard-404) must NOT count against the public per-IP
    // rate limiter — a crawler burst would otherwise 429 the internal fetch and
    // silently disable hard-404s for the window. ONLY exempt requests that carry
    // the valid internal secret; an unauthenticated/forged `/api/internal/*` hit
    // stays rate-limited so the secret cannot be flood-guessed without a 429. A
    // retired-alias-SHAPED request is never a legit self-call (the real one uses the
    // un-prefixed /api/internal path), so it is never exempt.
    const isExemptInternalCall =
      !isAliasApiShaped &&
      apiRateLimitPathname.startsWith('/api/internal/') &&
      isAuthenticatedInternalRequest(request);
    const rateLimitResult = isExemptInternalCall
      ? null
      : await checkRateLimit(request);
    if (rateLimitResult && !rateLimitResult.allowed) {
      return createRateLimitResponse(
        rateLimitResult.limit,
        rateLimitResult.remaining,
        rateLimitResult.resetTime
      );
    }
  }

  // CONFIRM the alias (DB lookup) — now bounded by the rate limiter above — so the
  // remaining guards apply to the EFFECTIVE /api path ONLY when the request will
  // actually be rewritten. An alias-shaped path whose prefix is NOT a retired alias is
  // an ordinary storefront page: it keeps the raw pathname and skips the /api guards.
  let apiSecurityPathname = apiRateLimitPathname;
  if (isAliasApiShaped && aliasApiShape) {
    const confirmedAliasSlug = await getCurrentSlugForAlias(
      aliasApiShape.prefix
    );
    apiSecurityPathname = confirmedAliasSlug
      ? aliasApiShape.apiPathname
      : pathname;
  }

  // ==== INPUT VALIDATION + CSRF (API Routes) ==== on the CONFIRMED /api path.
  if (apiSecurityPathname.startsWith('/api')) {
    // ==== INPUT VALIDATION (Mutation Requests) ====
    // Enforce Content-Type and body size limits at the edge
    const method = request.method;
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      // Reject oversized payloads (2MB limit, matches serverActions.bodySizeLimit)
      const contentLength = request.headers.get('content-length');
      if (
        contentLength &&
        Number.parseInt(contentLength, 10) > 2 * 1024 * 1024
      ) {
        return NextResponse.json(
          { error: 'Payload too large', maxSize: '2MB' },
          { status: 413 }
        );
      }

      // Enforce valid Content-Type for API mutations
      // Allow: JSON, form-data (file uploads), URL-encoded forms
      // Skip check if Content-Type is missing (some clients omit it)
      const contentType = request.headers.get('content-type') || '';
      if (
        contentType &&
        !contentType.includes('application/json') &&
        !contentType.includes('multipart/form-data') &&
        !contentType.includes('application/x-www-form-urlencoded')
      ) {
        return NextResponse.json(
          { error: 'Unsupported Content-Type' },
          { status: 415 }
        );
      }
    }

    // ==== CSRF: ORIGIN-BASED PROTECTION (2026 Best Practice) ====
    // Verify the Origin header on state-changing requests to prevent CSRF.
    // Modern browsers always send Origin on cross-origin requests; SameSite=Lax
    // cookies (Supabase default) add defense-in-depth. This single middleware
    // check replaces per-route checkCsrfProtection() calls — no client-side
    // token wiring needed, zero risk of breaking callers.
    const mutationMethod = request.method;
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(mutationMethod)) {
      // Skip: Bearer-authenticated requests (mobile apps) — tokens aren't
      // auto-attached like cookies, so CSRF doesn't apply.
      const authHeader = request.headers.get('Authorization');
      const isBearerAuth = authHeader?.startsWith('Bearer ');

      // Skip: Webhook endpoints — called by external services, not browsers.
      const isPaymentWebhook = /^\/api\/payments\/[^/]+\/webhook$/.test(
        apiSecurityPathname
      );
      const isWebhook =
        apiSecurityPathname.startsWith('/api/webhooks/') || isPaymentWebhook;

      // Skip: Auth callback routes — called by OAuth providers.
      const isAuthCallback = apiSecurityPathname.startsWith('/api/auth/');

      // Skip: Cron endpoints — called by Vercel cron, not browsers.
      const isCron = apiSecurityPathname.startsWith('/api/cron/');

      // Skip: Public analytics endpoint
      const isPublicAnalytics = apiSecurityPathname === '/api/platform/events';

      if (
        !isBearerAuth &&
        !isWebhook &&
        !isAuthCallback &&
        !isCron &&
        !isPublicAnalytics
      ) {
        const origin = request.headers.get('origin');

        // Origin is required on cross-site requests by all modern browsers.
        // Same-origin requests may omit it (e.g., form submissions), but
        // fetch() always sends it for non-GET methods.
        if (origin) {
          let originHostname: string;
          try {
            originHostname = new URL(origin).hostname.toLowerCase();
          } catch {
            return NextResponse.json(
              { error: 'Invalid Origin header' },
              { status: 403 }
            );
          }

          const normalizedRoot = ROOT_DOMAIN.toLowerCase();

          // Allow: exact root domain, any subdomain of root domain,
          // localhost/dev, and Vercel preview deployments.
          const isAllowed =
            originHostname === normalizedRoot ||
            originHostname.endsWith(`.${normalizedRoot}`) ||
            isLocalhost(originHostname) ||
            isVercelPreview(originHostname);

          if (!isAllowed) {
            // Check custom domains: look up whether this origin is a
            // registered merchant custom domain. Match storefront routing:
            // www.example.com is allowed when example.com is the registered
            // domain, with a raw www fallback for merchants that registered it.
            const customSlug =
              await getSlugForOriginCustomDomain(originHostname);
            if (!customSlug) {
              return NextResponse.json(
                { error: 'Cross-origin request blocked' },
                { status: 403 }
              );
            }
          }
        }
      }
    }
  }

  if (isLegacyKlumpWebhook) {
    const response = NextResponse.json(
      { error: 'Legacy Klump WooCommerce webhook endpoint retired' },
      { status: 410 }
    );
    const securedResponse = applySecurityHeaders(
      response,
      KLUMP_WEBHOOK_API_PATH,
      userAgent,
      'api',
      isLocalhost(hostname),
      undefined,
      request,
      hostname
    );
    securedResponse.headers.set('Cache-Control', 'no-store');
    return securedResponse;
  }

  if (isLegacyAnalyticsConversionPost) {
    const conversionUrl = new URL(
      ANALYTICS_CONVERSION_API_PATH + request.nextUrl.search,
      request.url
    );

    const response = NextResponse.rewrite(conversionUrl);
    return applySecurityHeaders(
      response,
      ANALYTICS_CONVERSION_API_PATH,
      userAgent,
      'api',
      isLocalhost(hostname),
      undefined,
      request,
      hostname
    );
  }

  // ==== BLOG MIGRATION REDIRECTS ====
  // 301 redirect old blog subdomain to new blog location
  // blog.ogabassey.com/* -> ogabassey.com/blog/*
  if (normalizeHostname(hostname) === 'blog.ogabassey.com') {
    // Strip accidental domain prefix from path (e.g., /ogabassey.com/blog/... → /blog/...)
    // Derive the root domain from the subdomain so this adapts automatically
    let cleanPath = pathname;
    const rootDomain = normalizeHostname(hostname).replace(/^blog\./, '');
    if (
      cleanPath.toLowerCase().startsWith(`/${rootDomain}/`) ||
      cleanPath.toLowerCase() === `/${rootDomain}`
    ) {
      cleanPath = cleanPath.slice(`/${rootDomain}`.length) || '/';
    }
    // Avoid double /blog/ when the malformed path already includes it
    if (cleanPath.startsWith('/blog/') || cleanPath === '/blog') {
      cleanPath = cleanPath.slice('/blog'.length) || '/';
    }
    // Drop a trailing slash so every blog-subdomain redirect lands on its
    // canonical target in one hop. This host is exempted from the generic
    // trailing-slash 308 above, so the normalization has to happen here.
    if (cleanPath.length > 1 && cleanPath.endsWith('/')) {
      cleanPath = cleanPath.replace(/\/+$/, '') || '/';
    }
    // Collapse dated WordPress permalinks (/YYYY/MM/DD/slug) here so the host
    // swap lands on the canonical post URL in one hop instead of chaining
    // through the /blog/[...catchAll] date-strip 308. Unknown slugs 404 at
    // the post route — the same terminal state the chained lookup produced.
    const datedPermalinkMatch = cleanPath.match(
      /^\/\d{4}\/\d{2}\/\d{2}\/([^/]+?)\/?$/
    );
    if (datedPermalinkMatch) {
      cleanPath = `/${datedPermalinkMatch[1]}`;
    }
    const newPath = cleanPath === '/' ? '' : cleanPath;
    const newUrl = `https://ogabassey.com/blog${newPath}`;
    return NextResponse.redirect(newUrl, { status: 301 });
  }

  // Repeatedly percent-encoded PDP slugs are deterministic bot/broken-link
  // traffic, never merchant content. Reject them before custom-domain or
  // product lookups can consume Vercel runtime and cache capacity. The legacy
  // blog host above deliberately keeps ownership of its WordPress redirects.
  const unsafeStorefrontPdpPath = resolveUnsafeStorefrontPdpPath(
    request,
    pathname,
    hostname,
    userAgent
  );
  if (unsafeStorefrontPdpPath) {
    return unsafeStorefrontPdpPath;
  }

  // ==== SECURITY: BLOCK KNOWN SEO SPAM ====
  // Block common spam patterns under /blog/ prevent "Crawled - currently not indexed"
  // and "Duplicate without user-selected canonical" errors (Soft 404s).
  // MOVED TO TOP to avoid redirecting spam.
  // Block legacy WordPress admin/auth probes under /blog/* AND
  // /{merchantSlug}/blog/* (root-domain storefronts proxy blog paths
  // under a merchant slug prefix). These are not public content pages
  // and should not be indexable. Match exact paths or true path segment
  // boundaries to avoid blocking legitimate post slugs that share these
  // prefixes (e.g. /blog/wp-admin-guide).
  if (
    /^\/(?:[^/]+\/)?blog\/(?:wp-admin|wp-login\.php|xmlrpc\.php)(?:\/|$)/i.test(
      pathname
    )
  ) {
    return new NextResponse('Gone', { status: 410 });
  }

  if (pathname.startsWith('/blog/')) {
    const lowerBlogPath = pathname.toLowerCase();
    const spamPatterns = [
      '/blog/shopdetail',
      '/blog/zhhant',
      '/blog/product',
      '/blog/category/product',
    ];
    if (
      spamPatterns.some(
        (pattern) =>
          lowerBlogPath === pattern || lowerBlogPath.startsWith(`${pattern}/`)
      )
    ) {
      return new NextResponse('Gone', { status: 410 });
    }

    // Canonicalize legacy WordPress category permalinks:
    // /blog/{category}/{post-slug} -> /blog/{post-slug}
    // Also drop thumbnail_id query param noise from migrated URLs
    // (both thumbnail_id and _thumbnail_id variants).
    // Exclude pagination, tags, and authors from being treated as posts.
    const blogExclusions = ['page', 'tag', 'author', 'category'];
    const blogMetadataEndpoints = ['opengraph-image', 'twitter-image'];
    const legacyCategoryMatch = pathname.match(/^\/blog\/([^/]+)\/([^/]+)\/?$/);
    const legacyCategoryTarget = legacyCategoryMatch?.[2]?.toLowerCase();
    const legacyCategoryTargetBase = legacyCategoryTarget?.replace(
      /\.(?:avif|gif|jpe?g|png|webp)$/,
      ''
    );
    const isBlogMetadataEndpoint =
      legacyCategoryTargetBase !== undefined &&
      blogMetadataEndpoints.includes(legacyCategoryTargetBase);
    const acceptHeader = request.headers.get('accept')?.toLowerCase() ?? '';
    const fetchDestination =
      request.headers.get('sec-fetch-dest')?.toLowerCase() ?? '';
    const isDocumentNavigation =
      fetchDestination === 'document' || acceptHeader.includes('text/html');
    const shouldBypassLegacyCategoryRedirect =
      isBlogMetadataEndpoint && !isDocumentNavigation;
    const isLegacyPost =
      legacyCategoryMatch &&
      !shouldBypassLegacyCategoryRedirect &&
      !blogExclusions.includes(legacyCategoryMatch[1].toLowerCase());

    const hasThumbnailId =
      request.nextUrl.searchParams.has('thumbnail_id') ||
      request.nextUrl.searchParams.has('_thumbnail_id');
    if (isLegacyPost || hasThumbnailId) {
      const redirectUrl = request.nextUrl.clone();
      if (isLegacyPost && legacyCategoryMatch) {
        redirectUrl.pathname = `/blog/${legacyCategoryMatch[2]}`;
      }
      redirectUrl.searchParams.delete('thumbnail_id');
      redirectUrl.searchParams.delete('_thumbnail_id');

      // Avoid self-redirect loops when only thumbnail_id was absent.
      if (
        redirectUrl.pathname !== pathname ||
        redirectUrl.search !== request.nextUrl.search
      ) {
        return NextResponse.redirect(redirectUrl, { status: 301 });
      }
    }
  }

  // ==== SEO: STRIP THUMBNAIL QUERY NOISE ====
  // WordPress/share tooling can append `thumbnail_id` or `_thumbnail_id`
  // to blog URLs. These params should not produce unique crawlable URLs.
  // Covers the platform blog (`/blog`, `/blog/...`) and storefront variants
  // served from the root domain (`/{slug}/blog`, `/{slug}/blog/...`).
  const isCanonicalizableBlogMethod =
    request.method === 'GET' || request.method === 'HEAD';

  if (
    isCanonicalizableBlogMethod &&
    BLOG_PATH_REGEX.test(pathname) &&
    (request.nextUrl.searchParams.has('thumbnail_id') ||
      request.nextUrl.searchParams.has('_thumbnail_id'))
  ) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.searchParams.delete('thumbnail_id');
    redirectUrl.searchParams.delete('_thumbnail_id');
    return NextResponse.redirect(redirectUrl, 301);
  }

  // ==== RFC 8615: WELL-KNOWN PASSTHROUGH ====
  // Let .well-known requests reach App Router route handlers unmodified.
  // Apple/Android app link verifiers reject redirects and rewrites.
  if (
    pathname.startsWith('/.well-known/') &&
    !isPublicMachineReadablePath(pathname)
  ) {
    return NextResponse.next();
  }

  // ==== PLATFORM MACHINE-READABLE PASSTHROUGH ====
  // App-owned agent discovery routes such as /auth.md must reach App Router on
  // the root platform host. Otherwise the slug-based markdown mirror below can
  // mistake /auth.md for a merchant mirror and rewrite it to /api/llm/auth.md.
  if (isPlatformHost(hostname) && isPublicMachineReadablePath(pathname)) {
    return buildMerchantFeedPassThroughResponse({
      request,
      pathname,
      userAgent,
      hostname,
    });
  }

  // ==== LLM DISCOVERY PASSTHROUGH ====
  // Keep host-scoped llms files available on both the platform domain and
  // merchant storefront domains without proxy rewrites.
  if (pathname === '/llms.txt' || pathname === '/llms-full.txt') {
    // This passthrough runs before the main subdomain alias redirect below, so
    // a retired storefront subdomain would otherwise keep serving its discovery
    // files (with the old host as canonical) instead of 301ing. Redirect retired
    // aliases here too; live subdomains fall through to next() unchanged.
    if (!isLocalhost(hostname)) {
      const llmsSlug = extractSubdomain(
        normalizeHostname(hostname),
        ROOT_DOMAIN
      );
      if (llmsSlug && !RESERVED_SUBDOMAINS.has(llmsSlug)) {
        const aliasRedirect = await resolveRetiredSlugRedirect(
          llmsSlug,
          pathname,
          request.nextUrl.search,
          request.method
        );
        if (aliasRedirect) {
          return NextResponse.redirect(aliasRedirect, 302);
        }
      }
    }
    return NextResponse.next();
  }

  // ==== INDEXNOW KEY FILE PASSTHROUGH ====
  // IndexNow validates ownership via a root-level `/<key>.txt` file. Keep the
  // platform key available on Baci-owned hosts here; registered custom domains
  // are handled after their merchant slug lookup so arbitrary hosts cannot
  // reuse the key.
  if (
    pathname === INDEXNOW_KEY_PATH &&
    (isRootDomain(hostname, ROOT_DOMAIN) || isVercelPreview(hostname))
  ) {
    return NextResponse.next();
  }

  // ==== LLM MARKDOWN MIRRORS (slug-based paths) ====
  // For root-domain paths like /ogabassey/about.md, rewrite to /api/llm/ogabassey/about
  // to avoid route collisions with dynamic [category] segments.
  // Custom domain and subdomain .md paths are handled in their respective sections below.
  const isPlatformMarkdownHost = isPlatformHost(hostname);

  if (
    isPlatformMarkdownHost &&
    pathname.endsWith('.md') &&
    !pathname.startsWith('/api') &&
    !pathname.startsWith('/_next')
  ) {
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length >= 1) {
      const slug = segments[0];
      const rest = pathname.slice(`/${slug}`.length);
      // Retired-slug markdown link (usebaci.com/<oldSlug>/about.md): 301 to the
      // current storefront URL before rewriting to the LLM API path, so these
      // links survive a rename too. Platform segments are excluded.
      if (
        isValidSubdomain(slug) &&
        !RESERVED_SUBDOMAINS.has(slug) &&
        !PLATFORM_ROOT_ROUTE_SEGMENTS.has(slug.toLowerCase())
      ) {
        const aliasRedirect = await resolveRetiredSlugRedirect(
          slug,
          rest || '/',
          request.nextUrl.search,
          request.method
        );
        if (aliasRedirect) {
          return NextResponse.redirect(aliasRedirect, 302);
        }
      }
      const mdUrl = request.nextUrl.clone();
      mdUrl.pathname = toLlmApiPath(rest, slug);
      return NextResponse.rewrite(mdUrl);
    }
  }

  // ==== SEO: ENFORCE LOWERCASE CANONICAL URLS ====
  // Full-path lowercase canonicalization for storefront routes and any other
  // public routes not covered by the prefix-only normalization above.
  // By the time execution reaches here, /api, /track, /_next, and other
  // main-app prefixes have already been normalized or excluded above, and
  // host-aware passthroughs (.well-known, llms) have been allowed through.
  const lowerPathname = pathname.toLowerCase();
  const normalizedStorefrontPathname = lowercaseStorefrontPathname(pathname);
  const isWellKnownPassthrough = lowerPathname.startsWith('/.well-known/');
  const isLlmsPassthrough =
    lowerPathname === '/llms.txt' || lowerPathname === '/llms-full.txt';
  const isStaticFile = STATIC_FILES_REGEX.test(lowerPathname);
  const isNonStorefrontPrefix = CASE_PRESERVING_PREFIXES.some(
    (prefix) =>
      lowerPathname === prefix || lowerPathname.startsWith(`${prefix}/`)
  );
  const rawPathname = new URL(request.url).pathname;
  const cacheSafeStorefrontPathname =
    normalizeCacheSafeStorefrontPathname(rawPathname);

  if (
    cacheSafeStorefrontPathname &&
    !isNonStorefrontPrefix &&
    !isStaticFile &&
    !isWellKnownPassthrough &&
    !isLlmsPassthrough
  ) {
    return NextResponse.redirect(
      new URL(
        cacheSafeStorefrontPathname + request.nextUrl.search,
        request.url
      ),
      308
    );
  }

  if (
    pathname !== normalizedStorefrontPathname &&
    !isNonStorefrontPrefix &&
    !isStaticFile &&
    !isWellKnownPassthrough &&
    !isLlmsPassthrough
  ) {
    return NextResponse.redirect(
      new URL(
        normalizedStorefrontPathname + request.nextUrl.search,
        request.url
      ),
      308
    );
  }

  const platformRouteSubdomain =
    hostname && !isLocalhost(hostname)
      ? extractSubdomain(hostname, ROOT_DOMAIN)
      : null;
  if (platformRouteSubdomain && matchesMainAppRoute(pathname)) {
    return NextResponse.redirect(new URL(pathname, `https://${ROOT_DOMAIN}`));
  }

  // ==== AUTH MIDDLEWARE (Server-side session verification) ====
  // For protected routes, verify auth BEFORE rendering
  // Define protected route patterns
  const isProtectedRoute =
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/builder') ||
    pathname.startsWith('/admin');

  // Define auth routes (login, signup, etc.)
  const isAuthRoute =
    pathname === '/login' ||
    // pathname === '/onboarding' || // Onboarding is protected, not an auth page to skip
    pathname === '/reset-password';

  // Only run auth check for protected or auth routes (skip for public routes)
  if (isProtectedRoute || isAuthRoute) {
    // Generate nonce and CSP before the app render. Next reads the forwarded
    // request CSP to nonce its framework and Flight scripts.
    const routeType = getRouteType(pathname);
    const isLocal = isLocalhost(hostname);
    const nonce = generateCspNonce();
    const csp = generateCSP(routeType, isLocal, nonce);

    // Prepare request headers with nonce
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-nonce', nonce);
    requestHeaders.set('Content-Security-Policy', csp);

    // Create a modified request instance to pass down
    const modifiedRequest = new NextRequest(request, {
      headers: requestHeaders,
    });

    // Create an initial response object that includes the modified request headers
    const initialResponse = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });

    // Update session (validates auth token)
    // Pass the modifiedRequest so it sees the new headers, and initialResponse as base
    const { supabaseResponse, user } = await updateSession(
      modifiedRequest,
      initialResponse
    );

    // Protected routes: redirect to login if no user
    if (isProtectedRoute && !user) {
      /*
      console.log(
        'Middleware: No user found for protected route',
        pathname.replace(/[\r\n]/g, '')
      );
      */
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.search = '';
      url.searchParams.set(
        'redirect',
        `${pathname}${request.nextUrl.search}${request.nextUrl.hash}`
      );
      return applySecurityHeaders(
        NextResponse.redirect(url),
        pathname,
        userAgent,
        routeType,
        isLocal,
        nonce,
        undefined,
        hostname
      );
    }

    // Auth routes: redirect to dashboard if already logged in
    if (isAuthRoute && user) {
      // console.log('Middleware: User found on auth route, redirecting to dashboard');
      const redirectTo = sanitizeProxyRedirectPath(
        request.nextUrl.searchParams.get('redirect') ??
          request.nextUrl.searchParams.get('redirectTo')
      );
      const url = request.nextUrl.clone();
      const redirectUrl = new URL(redirectTo, request.nextUrl.origin);
      url.pathname = redirectUrl.pathname;
      url.search = redirectUrl.search;
      url.hash = redirectUrl.hash;
      return applySecurityHeaders(
        NextResponse.redirect(url),
        pathname,
        userAgent,
        routeType,
        isLocal,
        nonce,
        undefined,
        hostname
      );
    }

    // For protected routes, apply security headers to the supabase response
    if (isProtectedRoute) {
      return applySecurityHeaders(
        supabaseResponse,
        pathname,
        userAgent,
        routeType,
        isLocal,
        nonce, // Pass the pre-generated nonce
        undefined,
        hostname
      );
    }

    // For Auth routes that aren't redirecting, we also need CSP headers (e.g. Login form)
    if (isAuthRoute) {
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

    return supabaseResponse;
  }

  // Extract subdomain with proper validation
  let subdomain: string | null = null;

  if (isLocalhost(hostname)) {
    // In development, support BOTH:
    // 1. ogabassey.localhost:3000 (subdomain-based, preferred, matches production)
    // 2. localhost:3000/ogabassey (path-based, fallback)
    const localSubdomain = extractLocalhostSubdomain(hostname);
    /*
    console.log(
      `[Middleware] Localhost detected. Host: ${hostname}, Extracted subdomain: ${localSubdomain}`
    );
    */
    if (localSubdomain) {
      subdomain = localSubdomain;
    } else {
      // Plain localhost - let path-based routing handle it
      subdomain = null;
    }
  } else {
    const extractedSubdomain = extractSubdomain(hostname, ROOT_DOMAIN);
    if (extractedSubdomain !== null) {
      subdomain = extractedSubdomain;
    } else if (
      isRootDomain(hostname, ROOT_DOMAIN) ||
      isVercelPreview(hostname)
    ) {
      // Root domain or Vercel preview - no subdomain, standard routing
      subdomain = null;
    } else if (isValidCustomDomain(hostname)) {
      // Custom domain: ogabassey.com - validated format
      // Normalize: lowercase, remove port, and strip 'www.' prefix for consistent lookup
      const normalizedRequestHost = normalizeHostname(hostname);
      const domain = normalizedRequestHost.replace(/^www\./, '');
      // Whether the ACTUAL request host carried the www. prefix (so the apex was
      // derived by stripping it). Scopes the www-counterpart auth-confirm
      // fallback below to genuine www requests only.
      const requestHostHadWww = normalizedRequestHost.startsWith('www.');
      const domainPathSegments = pathname.split('/').filter(Boolean);
      let domainMerchantSlug = await getSlugForCustomDomain(domain);

      // getSlugForCustomDomain's reverse domain->slug cache is per-instance with a
      // 5-minute TTL, so right after a rename an instance that cached the mapping
      // can still return the RETIRED slug — which would rewrite the storefront to
      // /<oldSlug>/... and 404. The alias table (DB, cross-instance authoritative)
      // fixes this: if the resolved slug is itself now a retired alias, follow it
      // to the current slug so the custom domain never 404s during that window.
      if (domainMerchantSlug) {
        const currentForDomainSlug =
          await getCurrentSlugForAlias(domainMerchantSlug);
        if (
          currentForDomainSlug &&
          currentForDomainSlug !== domainMerchantSlug
        ) {
          domainMerchantSlug = currentForDomainSlug;
        }
      }

      // Retired slug PREFIX on a custom domain (custom.example/<oldSlug>/...):
      // if the first segment is a slug this merchant used to have — i.e. its
      // alias now resolves to the domain's CURRENT slug — 301 to the un-prefixed
      // custom-domain URL (same host, prefix dropped) so those legacy links keep
      // working after a rename. Only GET/HEAD (a 301 on POST drops the body).
      // API paths (/<oldSlug>/api/...) are EXCLUDED here — a 301 would preserve a
      // stale ?merchant_slug=old query and drop bodies; the retired-alias API
      // rewrite below handles them (any method) and rewrites those query params.
      if (
        domainMerchantSlug &&
        domainPathSegments.length >= 1 &&
        domainPathSegments[1]?.toLowerCase() !== 'api' &&
        (request.method === 'GET' || request.method === 'HEAD')
      ) {
        const firstSegment = domainPathSegments[0].toLowerCase();
        if (
          firstSegment !== domainMerchantSlug.toLowerCase() &&
          isValidSubdomain(firstSegment) &&
          // RESERVED_SUBDOMAINS is intentionally NOT excluded here: a merchant that
          // held an infra name (e.g. `cdn`, `support`) as a slug before it was
          // reserved could have retired it, so custom.example/<oldReservedSlug>/...
          // must still strip. The merchant-scoped alias check below (aliasCurrentSlug
          // === domainMerchantSlug) is what gates the strip — a non-alias reserved
          // prefix resolves to no alias and safely falls through as a storefront path.
          // A retired slug that collides with a real storefront route (e.g. a
          // store once slugged "blog") must not strip its own live /blog route,
          // nor a platform app route reachable here (e.g. /auth/confirm, /feeds/*).
          // ACCEPTED TRADEOFF: a merchant's live [category] / [category]/[product]
          // paths are DYNAMIC per-merchant data and can't be enumerated statically,
          // so if a merchant's OWN retired slug equals their OWN live category name
          // (e.g. renamed away from "shoes" while /shoes is still a category), that
          // one path would be stripped. This is astronomically narrow and is the
          // SAME limitation the pre-existing current-slug canonicalization below
          // (~/<currentSlug>/<cat>/<prod>) already has — a per-request category
          // membership DB lookup on every custom-domain path isn't worth it.
          !RETIRED_SLUG_STRIP_LIVE_PAGE_SEGMENTS.has(firstSegment) &&
          !CUSTOM_DOMAIN_APP_ROUTE_FIRST_SEGMENTS.has(firstSegment)
        ) {
          const aliasCurrentSlug = await getCurrentSlugForAlias(firstSegment);
          if (
            aliasCurrentSlug &&
            aliasCurrentSlug.toLowerCase() === domainMerchantSlug.toLowerCase()
          ) {
            const strippedPathname =
              pathname.slice(`/${domainPathSegments[0]}`.length) || '/';
            const normalizedPathname =
              normalizeStorefrontTermsAliasPath(strippedPathname);
            // 302 (temporary): the alias is reversible via rename-back, so a
            // browser-cached permanent redirect could loop.
            return NextResponse.redirect(
              `https://${domain}${normalizedPathname}${request.nextUrl.search}`,
              302
            );
          }
        }
      }

      if (pathname === '/favicon.ico') {
        return buildStorefrontFaviconRewriteResponse({
          request,
          pathname,
          userAgent,
          hostname,
          routeIdentifier: domainMerchantSlug ?? domain,
          customDomain: domain,
          merchantSlug: domainMerchantSlug,
        });
      }

      if (pathname === INDEXNOW_KEY_PATH && domainMerchantSlug) {
        const requestHeaders = buildProxyRequestHeaders(request);
        requestHeaders.set('x-custom-domain', domain);
        requestHeaders.set('x-merchant-domain', domain);
        requestHeaders.set('x-merchant-slug', domainMerchantSlug);

        return NextResponse.next({
          request: {
            headers: requestHeaders,
          },
        });
      }

      if (pathname === STOREFRONT_ROOT_SITEMAP_PATH) {
        // The dynamic storefront route tree can otherwise treat `sitemap.xml`
        // as a category segment. Keep the public URL stable while routing to
        // the request-aware XML route handler for 503/no-store support.
        return buildStorefrontRootSitemapRewriteResponse({
          request,
          pathname,
          userAgent,
          hostname,
          routeIdentifier: domainMerchantSlug ?? domain,
          customDomain: domain,
          merchantSlug: domainMerchantSlug,
        });
      }

      // Public machine-readable contracts are App Router routes, not storefront pages.
      // Run before slug-prefix canonicalization so a merchant slug named
      // "feeds" cannot shadow the canonical XML feed endpoint.
      if (isPublicMachineReadablePath(pathname)) {
        return buildMerchantFeedPassThroughResponse({
          request,
          pathname,
          userAgent,
          hostname,
          customDomain: domain,
          merchantSlug: domainMerchantSlug,
        });
      }

      const directLegacyTermsAliasRedirect =
        buildLegacyTermsAliasRedirectResponse(request, pathname);
      if (directLegacyTermsAliasRedirect) {
        return directLegacyTermsAliasRedirect;
      }

      if (
        domainMerchantSlug &&
        domainPathSegments[0]?.toLowerCase() ===
          domainMerchantSlug.toLowerCase() &&
        // Only canonicalize safe/idempotent methods. A 301 on POST/PUT/etc.
        // lets clients replay as GET, which drops the body and breaks
        // non-idempotent flows (checkout, order creation) when legacy
        // slug-prefixed API URLs are hit on a custom domain.
        (request.method === 'GET' || request.method === 'HEAD')
      ) {
        // First segment already confirmed equal (case-insensitive) to the
        // merchant slug above; drop it by length instead of building a regex
        // from a variable (avoids CWE-1333 and any escaping concerns).
        const strippedPathname =
          pathname.slice(domainPathSegments[0].length + 1) || '/';
        const strippedSegments = strippedPathname.split('/').filter(Boolean);
        const firstStrippedSegment = strippedSegments[0]?.toLowerCase();
        const normalizedTermsAliasPathname =
          normalizeStorefrontTermsAliasPath(strippedPathname);
        // Only collapse `/merchantSlug/{category}/{productSlug}` to
        // `/products/{productSlug}` — i.e. exactly two stripped segments. Longer
        // paths can be legitimate category subroutes such as
        // `/{category}/compare/{comparisonSlug}` or `/{category}/best-under/{priceBandSlug}`
        // (see apps/web/src/app/(storefront)/[slug]/(catalog)/[category]/compare
        // and .../best-under). Collapsing those to `/products/{lastSegment}`
        // would 301 merchants to URLs that don't exist.
        const shouldNormalizeToProductRoute =
          normalizedTermsAliasPathname === strippedPathname &&
          strippedSegments.length === 2 &&
          !!firstStrippedSegment &&
          !RESERVED_STOREFRONT_SEGMENTS.has(firstStrippedSegment);

        const normalizedPathname =
          normalizedTermsAliasPathname !== strippedPathname
            ? normalizedTermsAliasPathname
            : shouldNormalizeToProductRoute
              ? `/products/${strippedSegments[strippedSegments.length - 1]}`
              : strippedPathname;
        const normalizedUrl = `https://${domain}${normalizedPathname}${request.nextUrl.search}`;

        if (normalizedUrl !== request.nextUrl.href) {
          return NextResponse.redirect(normalizedUrl, 301);
        }
      }

      // Slug-prefixed API requests (e.g. POST /{merchantSlug}/api/orders) on
      // custom domains need to be rewritten to /api/... regardless of method.
      // A 301 redirect is unsafe for non-idempotent verbs (body is dropped on
      // replay), but an internal rewrite preserves method + body. Only applies
      // when the first segment matches the domain's merchant slug AND the
      // second segment is literally 'api'.
      if (
        domainMerchantSlug &&
        domainPathSegments[0]?.toLowerCase() ===
          domainMerchantSlug.toLowerCase() &&
        domainPathSegments[1]?.toLowerCase() === 'api'
      ) {
        const strippedApiPathname =
          pathname.slice(domainPathSegments[0].length + 1) || '/';
        const apiUrl = request.nextUrl.clone();
        apiUrl.pathname = strippedApiPathname;

        const apiHeaders = buildProxyRequestHeaders(request);
        apiHeaders.set('x-custom-domain', domain);
        apiHeaders.set('x-merchant-domain', domain);

        const response = NextResponse.rewrite(apiUrl, {
          request: {
            headers: apiHeaders,
          },
        });

        const routeType = getRouteType(strippedApiPathname);
        const isLocal = isLocalhost(hostname);
        return applySecurityHeaders(
          response,
          strippedApiPathname,
          userAgent,
          routeType,
          isLocal,
          undefined,
          request,
          hostname
        );
      }

      // RETIRED-slug-prefixed API requests on custom domains, any method:
      // custom.example/<oldSlug>/api/... where <oldSlug> is a slug this merchant
      // used to have. The current-slug API rewrite above only matches the CURRENT
      // slug, and the GET/HEAD prefix strip earlier only 301s storefront paths, so
      // a stale client's non-idempotent call (POST /oldSlug/api/storefront/customer)
      // would otherwise fall through to the storefront rewrite and 405. Internally
      // rewrite to /api/... (body + method preserved). Cheap guards run BEFORE the
      // alias DB lookup to bound its cost, and exclude storefront/app route prefixes
      // so /blog/api/... (blog = a route, not this merchant's alias) isn't touched.
      if (
        domainMerchantSlug &&
        domainPathSegments[1]?.toLowerCase() === 'api' &&
        domainPathSegments[0]
      ) {
        const aliasPrefix = domainPathSegments[0].toLowerCase();
        if (
          aliasPrefix !== domainMerchantSlug.toLowerCase() &&
          isValidSubdomain(aliasPrefix) &&
          // RESERVED_SUBDOMAINS intentionally NOT excluded (matches the non-API
          // prefix strip): the backfill records a grandfathered infra slug (e.g.
          // `support`, `cdn`) as this merchant's alias, so store.example/support/api/…
          // must still rewrite. The merchant-scoped alias check below gates it.
          !STOREFRONT_ROUTE_FIRST_SEGMENTS.has(aliasPrefix) &&
          !CUSTOM_DOMAIN_APP_ROUTE_FIRST_SEGMENTS.has(aliasPrefix)
        ) {
          const aliasCurrentSlug = await getCurrentSlugForAlias(aliasPrefix);
          if (
            aliasCurrentSlug &&
            aliasCurrentSlug.toLowerCase() === domainMerchantSlug.toLowerCase()
          ) {
            const strippedApiPathname =
              pathname.slice(domainPathSegments[0].length + 1) || '/';
            const apiUrl = request.nextUrl.clone();
            apiUrl.pathname = strippedApiPathname;
            // Rewrite stale slug-bearing query params to the current slug —
            // query-based endpoints (track-order/wallet) resolve the merchant from
            // these, not the forwarded custom-domain header.
            for (const param of MERCHANT_SLUG_QUERY_PARAMS) {
              if (
                apiUrl.searchParams.get(param)?.toLowerCase() === aliasPrefix
              ) {
                apiUrl.searchParams.set(param, aliasCurrentSlug);
              }
            }

            const apiHeaders = buildProxyRequestHeaders(request);
            apiHeaders.set('x-custom-domain', domain);
            apiHeaders.set('x-merchant-domain', domain);

            const response = NextResponse.rewrite(apiUrl, {
              request: { headers: apiHeaders },
            });

            const routeType = getRouteType(strippedApiPathname);
            const isLocal = isLocalhost(hostname);
            return applySecurityHeaders(
              response,
              strippedApiPathname,
              userAgent,
              routeType,
              isLocal,
              undefined,
              request,
              hostname
            );
          }
        }
      }

      // API routes should NOT be rewritten - they exist at /api/*, not /domain/api/*
      // This fixes 405 errors when calling APIs from custom domains
      // API routes should NOT be rewritten - they exist at /api/*, not /domain/api/*
      // This fixes 405 errors when calling APIs from custom domains
      if (pathname.startsWith('/api')) {
        const requestHeaders = buildProxyRequestHeaders(request);
        requestHeaders.set('x-custom-domain', domain);
        requestHeaders.set('x-merchant-domain', domain);

        // Correct stale slug query params: after a rename, an open tab on the
        // custom domain calls root-relative /api?merchant=old / ?merchantSlug=old
        // with the RETIRED slug (no /<slug>/api prefix). Rewrite any such param
        // whose value is a retired alias of THIS domain's merchant to the current
        // slug so query-based handlers resolve the store instead of 404ing. The
        // getCurrentSlugForAlias lookup only fires for a param value that differs
        // from the current slug (i.e. the rare post-rename case).
        let apiUrl: URL | null = null;
        if (domainMerchantSlug) {
          const current = domainMerchantSlug.toLowerCase();
          const url = request.nextUrl.clone();
          for (const param of MERCHANT_SLUG_QUERY_PARAMS) {
            const value = url.searchParams.get(param)?.toLowerCase();
            if (value && value !== current) {
              const aliasCurrent = await getCurrentSlugForAlias(value);
              if (aliasCurrent && aliasCurrent.toLowerCase() === current) {
                url.searchParams.set(param, domainMerchantSlug);
              }
            }
          }
          if (url.search !== request.nextUrl.search) {
            apiUrl = url;
          }
        }

        const response = apiUrl
          ? NextResponse.rewrite(apiUrl, {
              request: { headers: requestHeaders },
            })
          : NextResponse.next({ request: { headers: requestHeaders } });

        const routeType = getRouteType(pathname); // returns 'api'
        const isLocal = isLocalhost(hostname);
        return applySecurityHeaders(
          response,
          pathname,
          userAgent,
          routeType,
          isLocal,
          undefined,
          request,
          hostname
        );
      }

      // Auth confirmation links (one-click magic-link / signup / recovery)
      // emitted for custom-domain storefronts point at
      // https://<custom-domain>/auth/confirm. Like /api, this route lives at
      // /auth/confirm (not /{domain}/auth/confirm), so pass it through instead
      // of storefront-rewriting it — otherwise the token never reaches the
      // verifier and the session cookie is never set on the custom domain.
      // Scoped to /auth/confirm only; the rest of /auth stays storefront-bound.
      if (
        pathname === '/auth/confirm' ||
        pathname.startsWith('/auth/confirm/')
      ) {
        // Only pass through for a REGISTERED merchant custom domain (unknown
        // hosts still get the storefront rewrite). `domain` has the www prefix
        // stripped, so a www-only registration leaves the apex slug null. Only
        // fall back to the www host when the REQUEST itself was on www. — never
        // promote an unregistered apex request just because the www counterpart
        // is registered (that would make a non-merchant host an auth-confirm
        // origin that receives session cookies).
        const confirmMerchantSlug =
          domainMerchantSlug ??
          (requestHostHadWww
            ? await getSlugForCustomDomain(normalizedRequestHost)
            : null);
        if (confirmMerchantSlug) {
          const requestHeaders = buildProxyRequestHeaders(request);
          requestHeaders.set('x-custom-domain', domain);
          requestHeaders.set('x-merchant-domain', domain);

          const response = NextResponse.next({
            request: {
              headers: requestHeaders,
            },
          });

          const routeType = getRouteType(pathname); // returns 'auth'
          const isLocal = isLocalhost(hostname);
          return applySecurityHeaders(
            response,
            pathname,
            userAgent,
            routeType,
            isLocal,
            undefined,
            request,
            hostname
          );
        }
      }

      // Prevent redirect loop: if the path already starts with the domain,
      // it means we've already rewritten. Just let it pass through.
      // Use segment boundary check to avoid false positives (e.g., /shop.common matching /shop.com)
      const isAlreadyRewritten =
        pathname === `/${domain}` || pathname.startsWith(`/${domain}/`);

      if (isAlreadyRewritten) {
        // Already rewritten, just pass through with headers set
        const requestHeaders = buildProxyRequestHeaders(request);
        requestHeaders.set('x-custom-domain', domain);
        requestHeaders.set('x-merchant-domain', domain);

        const response = NextResponse.next({
          request: {
            headers: requestHeaders,
          },
        });

        const routeType = getRouteType(pathname);
        const isLocal = isLocalhost(hostname);
        // Custom Domain routes might need CSP too if they map to storefront?
        // But getRouteType logic treats them as storefront usually.
        // If they access dashboard logic via custom domain (unlikely), they would hit auth block first.

        return applySecurityHeaders(
          response,
          pathname,
          userAgent,
          routeType,
          isLocal,
          undefined, // Storefront doesn't need strict nonce usually, or we can add it if needed
          request,
          hostname
        );
      }

      // Sitemap file paths: rewrite using merchant slug (not domain) to avoid
      // dots in [slug], which break Next.js metadata file-convention routing.
      if (
        pathname.startsWith('/sitemap/') ||
        pathname === '/blog/sitemap.xml'
      ) {
        const sitemapUrl = request.nextUrl.clone();
        // Use merchant slug if found, otherwise fall through to domain-based rewrite
        sitemapUrl.pathname = `/${domainMerchantSlug ?? domain}${pathname}`;

        const sitemapHeaders = buildProxyRequestHeaders(request);
        sitemapHeaders.set('x-custom-domain', domain);
        sitemapHeaders.set('x-merchant-domain', domain);
        if (domainMerchantSlug) {
          sitemapHeaders.set('x-merchant-slug', domainMerchantSlug);
        }

        const response = NextResponse.rewrite(sitemapUrl, {
          request: {
            headers: sitemapHeaders,
          },
        });

        const routeType = getRouteType(pathname);
        const isLocal = isLocalhost(hostname);

        return applySecurityHeaders(
          response,
          pathname,
          userAgent,
          routeType,
          isLocal,
          undefined,
          request,
          hostname
        );
      }

      // LLM markdown mirrors: rewrite .md paths to /api/llm/ to avoid
      // route collisions with dynamic [category] segments in the storefront tree.
      if (pathname.endsWith('.md')) {
        if (domainMerchantSlug) {
          const mdUrl = request.nextUrl.clone();
          mdUrl.pathname = toLlmApiPath(pathname, domainMerchantSlug);

          const mdHeaders = buildProxyRequestHeaders(request);
          mdHeaders.set('x-custom-domain', domain);
          mdHeaders.set('x-merchant-domain', domain);

          return NextResponse.rewrite(mdUrl, {
            request: { headers: mdHeaders },
          });
        }
        // Slug lookup failed — fall through to standard domain rewrite
      }

      const blogPostHardStatus = await resolveStorefrontBlogPostHardStatus(
        request,
        pathname,
        hostname,
        userAgent,
        domainMerchantSlug ?? domain
      );
      if (blogPostHardStatus) {
        return blogPostHardStatus;
      }

      const blogListingHardStatus =
        await resolveStorefrontBlogListingHardStatus(
          request,
          pathname,
          hostname,
          userAgent,
          domainMerchantSlug ?? domain
        );
      if (blogListingHardStatus) {
        return blogListingHardStatus;
      }

      const comparePageHardStatus =
        await resolveStorefrontComparePageHardStatus(
          request,
          pathname,
          hostname,
          userAgent,
          domainMerchantSlug ?? domain
        );
      if (comparePageHardStatus) {
        return comparePageHardStatus;
      }

      const pdpCanonicalRedirect = await resolveStorefrontPdpCanonicalRedirect(
        request,
        pathname,
        hostname,
        domainMerchantSlug ?? domain
      );
      if (pdpCanonicalRedirect.response) {
        return pdpCanonicalRedirect.response;
      }

      // Crawl-budget hard-404 (PR-B §3.2): a confirmed-missing PDP product slug
      // gets a real 404 instead of a soft-404 shell. Fail-open; runs before the
      // storefront rewrite so a true typo never reaches the dynamic route.
      if (!pdpCanonicalRedirect.skipHardNotFound) {
        const pdpHardNotFound = await resolveStorefrontPdpHardNotFound(
          request,
          pathname,
          hostname,
          userAgent,
          domainMerchantSlug ?? domain
        );
        if (pdpHardNotFound) {
          return pdpHardNotFound;
        }
      }

      // First visit: Rewrite to /${domain}${pathname} so the storefront [slug] route handles it
      const url = request.nextUrl.clone();
      url.pathname = `/${domain}${pathname}`;
      const routeType = getRouteType(pathname);
      // Vercel/Next can overwrite configured HTML Vary for PPR responses; the
      // internal query param keeps empty-UA streamed shells out of browser cache
      // buckets without changing the public URL or canonical metadata.
      if (
        shouldPartitionStorefrontMetadataCache(pathname, hostname, routeType)
      ) {
        setStorefrontMetadataCacheBucketSearchParam(url, request);
      }

      const requestHeaders = buildProxyRequestHeaders(request);
      requestHeaders.set('x-custom-domain', domain);
      requestHeaders.set('x-merchant-domain', domain);

      const response = NextResponse.rewrite(url, {
        request: {
          headers: requestHeaders,
        },
      });

      // Generate route-specific CSP
      const isLocal = isLocalhost(hostname);

      return applySecurityHeaders(
        response,
        pathname,
        userAgent,
        routeType,
        isLocal,
        undefined,
        request, // Pass request for click ID capture on storefront
        hostname
      );
    }
  }

  // ==== OPENTELEMETRY: MERCHANT CONTEXT ====
  // Inject merchant slug/domain into the active trace span for multi-tenant observability.
  // This enables per-merchant filtering in the Vercel Observability dashboard.
  const activeSpan = trace.getActiveSpan();
  if (activeSpan) {
    if (subdomain) activeSpan.setAttribute('merchant.slug', subdomain);

    // Capture custom domain if available (normalized domain from the logic below)
    const domain = normalizeHostname(hostname).replace(/^www\./, '');
    if (
      domain &&
      domain !== ROOT_DOMAIN &&
      !isLocalhost(hostname) &&
      !isVercelPreview(hostname)
    ) {
      activeSpan.setAttribute('merchant.domain', domain);
    }
  }

  // Reserved-infra subdomains (cdn, mail, ...) are normally NOT storefronts and skip
  // the block below. But a merchant that held one of these slugs before it was reserved
  // (grandfathered) could have retired it via a rename — its old URL must still resolve
  // to the current store, since the alias table and auth resolver keep such slugs
  // resolvable.
  if (
    subdomain &&
    RESERVED_SUBDOMAINS.has(subdomain) &&
    !isLocalhost(hostname)
  ) {
    // /api on a reserved retired-alias subdomain (e.g. support.usebaci.com/api/...):
    // same-origin, alias-aware API handling — a 301 would drop the stale XHR's cookies/
    // body and leave the retired slug in headers/query. Only a genuine retired alias is
    // rewritten; a non-alias reserved subdomain's /api passes through unchanged.
    if (pathname.startsWith('/api')) {
      const currentSlug = await getCurrentSlugForAlias(subdomain);
      if (currentSlug && currentSlug !== subdomain) {
        return buildSubdomainApiResponse(
          request,
          subdomain,
          hostname,
          userAgent
        );
      }
    } else if (matchesMainAppRoute(pathname)) {
      return NextResponse.redirect(new URL(pathname, `https://${ROOT_DOMAIN}`));
    } else {
      // Non-API storefront path: retired-alias 302 to the current store.
      const aliasRedirect = await resolveRetiredSlugRedirect(
        subdomain,
        pathname,
        request.nextUrl.search,
        request.method
      );
      if (aliasRedirect) {
        return NextResponse.redirect(aliasRedirect, 302);
      }
    }
  }

  // If we have a valid subdomain (not reserved), rewrite to storefront routes
  if (subdomain && !RESERVED_SUBDOMAINS.has(subdomain)) {
    // ==== REDIRECT RETIRED SLUG TO CURRENT SLUG ====
    // Runs FIRST — before favicon, main-app, and .md handling — so EVERY storefront
    // path on a retired subdomain (/, /favicon.ico, /*.md, /products/..., ...) 301s
    // to the current storefront URL after a rename, not just the page routes. If
    // this subdomain is a slug the store used to have (renamed via "Change store
    // URL"), old links, bookmarks, and QR codes keep working instead of 404ing.
    // EXCEPTION: /api/* is handled by the subdomain API branch below (header +
    // query-param rewrite, not a 301) — a cross-origin 301 on an XHR drops cookies/
    // CORS and POST bodies, and a stale ?merchantSlug=old would survive the redirect.
    // EXCEPTION: MAIN_APP_ROUTES (/dashboard, /login, /auth, ...) must fall through
    // to the platform redirect below (-> usebaci.com/<route>), NOT be treated as a
    // storefront path — otherwise old.usebaci.com/dashboard would 302 to the
    // merchant's storefront/custom-domain and 404, breaking old admin/auth bookmarks.
    if (
      !isLocalhost(hostname) &&
      !pathname.startsWith('/api') &&
      !matchesMainAppRoute(pathname)
    ) {
      const aliasRedirect = await resolveRetiredSlugRedirect(
        subdomain,
        pathname,
        request.nextUrl.search,
        request.method
      );
      if (aliasRedirect) {
        // 302 (temporary): a merchant can rename BACK (A->B->A), so a browser-
        // cached permanent redirect would loop against the reverse alias.
        return NextResponse.redirect(aliasRedirect, 302);
      }
    }

    if (pathname === '/favicon.ico') {
      return buildStorefrontFaviconRewriteResponse({
        request,
        pathname,
        userAgent,
        hostname,
        routeIdentifier: subdomain,
        merchantSlug: subdomain,
      });
    }

    // Check if trying to access main app routes from subdomain - redirect to main domain
    if (matchesMainAppRoute(pathname)) {
      return NextResponse.redirect(new URL(pathname, `https://${ROOT_DOMAIN}`));
    }

    // ==== REDIRECT SUBDOMAIN TO CUSTOM DOMAIN ====
    // If merchant has a custom domain, redirect subdomain URLs to prevent duplicate content
    // Example: ogabassey.usebaci.com -> ogabassey.com
    let customDomain: string | null = null;
    if (!isLocalhost(hostname)) {
      customDomain = await getCustomDomainForSlug(subdomain);
      const legacyTermsAliasRedirect = buildLegacyTermsAliasRedirectResponse(
        request,
        pathname,
        customDomain ?? undefined
      );
      if (legacyTermsAliasRedirect) {
        return legacyTermsAliasRedirect;
      }
      // Only GET/HEAD get the canonical custom-domain 301. A cross-origin redirect
      // drops same-origin cookies, CORS-fails credentialed requests, and turns a POST
      // into a GET (losing its body) — so non-GET/HEAD (storefront server actions /
      // form POSTs to page routes) must fall through to storefront handling, which is
      // alias-aware for retired subdomains. /api is exempt for the same reason (its
      // same-origin rewrite is below). Canonicalization is a SEO/GET concern anyway;
      // mutations carry no duplicate-content risk.
      const isCanonicalizableMethod =
        request.method === 'GET' || request.method === 'HEAD';
      if (
        customDomain &&
        !pathname.startsWith('/api') &&
        isCanonicalizableMethod
      ) {
        const customDomainUrl = `https://${customDomain}${pathname}${request.nextUrl.search}`;
        return NextResponse.redirect(customDomainUrl, 301);
      }
    } else {
      const legacyTermsAliasRedirect = buildLegacyTermsAliasRedirectResponse(
        request,
        pathname
      );
      if (legacyTermsAliasRedirect) {
        return legacyTermsAliasRedirect;
      }
    }

    // Rewrite subdomain requests to path-based storefront routes
    // ogabassey.usebaci.com/smartphones/iphone-12 -> /ogabassey/smartphones/iphone-12

    // ==== FIX: API Routes on Subdomains ====
    // Do NOT rewrite API routes to /[subdomain]/api/...; pass them through with headers
    // (same-origin, alias-aware). Shared with the reserved-subdomain fallback.
    if (pathname.startsWith('/api')) {
      return buildSubdomainApiResponse(
        request,
        subdomain as string,
        hostname,
        userAgent
      );
    }

    // Public machine-readable contracts are App Router routes, not storefront pages.
    if (isPublicMachineReadablePath(pathname)) {
      return buildMerchantFeedPassThroughResponse({
        request,
        pathname,
        userAgent,
        hostname,
        merchantSlug: subdomain,
      });
    }

    if (pathname === STOREFRONT_ROOT_SITEMAP_PATH) {
      return buildStorefrontRootSitemapRewriteResponse({
        request,
        pathname,
        userAgent,
        hostname,
        routeIdentifier: subdomain,
        merchantSlug: subdomain,
      });
    }

    // LLM markdown mirrors: rewrite .md paths to /api/llm/ to avoid
    // route collisions with dynamic [category] segments in the storefront tree.
    if (pathname.endsWith('.md')) {
      const mdUrl = request.nextUrl.clone();
      mdUrl.pathname = toLlmApiPath(pathname, subdomain as string);

      const mdHeaders = buildProxyRequestHeaders(request);
      mdHeaders.set('x-merchant-slug', subdomain as string);

      return NextResponse.rewrite(mdUrl, {
        request: { headers: mdHeaders },
      });
    }

    const subdomainBlogPostHardStatus =
      await resolveStorefrontBlogPostHardStatus(
        request,
        pathname,
        hostname,
        userAgent,
        subdomain as string
      );
    if (subdomainBlogPostHardStatus) {
      return subdomainBlogPostHardStatus;
    }

    const subdomainBlogListingHardStatus =
      await resolveStorefrontBlogListingHardStatus(
        request,
        pathname,
        hostname,
        userAgent,
        subdomain as string
      );
    if (subdomainBlogListingHardStatus) {
      return subdomainBlogListingHardStatus;
    }

    const subdomainComparePageHardStatus =
      await resolveStorefrontComparePageHardStatus(
        request,
        pathname,
        hostname,
        userAgent,
        subdomain as string
      );
    if (subdomainComparePageHardStatus) {
      return subdomainComparePageHardStatus;
    }

    const subdomainPdpCanonicalRedirect =
      await resolveStorefrontPdpCanonicalRedirect(
        request,
        pathname,
        hostname,
        subdomain as string
      );
    if (subdomainPdpCanonicalRedirect.response) {
      return subdomainPdpCanonicalRedirect.response;
    }

    // Crawl-budget hard-404 (PR-B §3.2) for SUBDOMAIN storefronts
    // (`{slug}.usebaci.com/{category}/{product}`). Same fail-open guard as the
    // custom-domain branch; identifier is the subdomain. The subdomain host is
    // not a platform host, so content segments are not slug-sliced here.
    if (!subdomainPdpCanonicalRedirect.skipHardNotFound) {
      const subdomainPdpHardNotFound = await resolveStorefrontPdpHardNotFound(
        request,
        pathname,
        hostname,
        userAgent,
        subdomain as string
      );
      if (subdomainPdpHardNotFound) {
        return subdomainPdpHardNotFound;
      }
    }

    const url = request.nextUrl.clone();
    url.pathname = `/${subdomain}${pathname}`;
    const routeType = getRouteType(pathname);
    if (shouldPartitionStorefrontMetadataCache(pathname, hostname, routeType)) {
      setStorefrontMetadataCacheBucketSearchParam(url, request);
    }

    const requestHeaders = buildProxyRequestHeaders(request);
    requestHeaders.set('x-merchant-slug', subdomain as string);

    const response = NextResponse.rewrite(url, {
      request: {
        headers: requestHeaders,
      },
    });

    const isLocal = isLocalhost(hostname);

    return applySecurityHeaders(
      response,
      pathname,
      userAgent,
      routeType,
      isLocal,
      undefined, // Storefront doesn't strictly need nonce for now
      request, // Pass request for click ID capture on storefront
      hostname
    );
  }

  // ==== REDIRECT SLUG-BASED URLS TO CUSTOM DOMAIN ====
  // If a merchant has a custom domain, redirect slug-based URLs to prevent duplicate content
  // Example: usebaci.com/ogabassey -> ogabassey.com
  if (
    (isRootDomain(hostname, ROOT_DOMAIN) || isVercelPreview(hostname)) &&
    !isLocalhost(hostname)
  ) {
    const pathSegments = pathname.split('/').filter(Boolean);
    const isRootDomainOnlyMainAppRoute = ROOT_DOMAIN_ONLY_MAIN_APP_ROUTES.some(
      (route) => pathname === route || pathname.startsWith(`${route}/`)
    );
    if (
      pathSegments.length >= 1 &&
      !isRootDomainOnlyMainAppRoute &&
      !matchesMainAppRoute(pathname)
    ) {
      const potentialSlug = pathSegments[0];

      // A grandfathered infra-reserved slug (e.g. `support`, `cdn`) that the backfill
      // retired is recorded as an alias, so usebaci.com/<reservedAlias>/... must still
      // 302 to the current store — the main block below skips reserved segments. Only
      // non-platform reserved names (PLATFORM_ROOT_ROUTE_SEGMENTS are real platform
      // pages) and non-API/non-GET-safe paths are eligible; resolveRetiredSlugRedirect
      // returns null (fall through) unless it is genuinely a retired alias.
      if (
        isValidSubdomain(potentialSlug) &&
        RESERVED_SUBDOMAINS.has(potentialSlug) &&
        !PLATFORM_ROOT_ROUTE_SEGMENTS.has(potentialSlug.toLowerCase())
      ) {
        if (pathSegments[1]?.toLowerCase() === 'api') {
          const currentSlug = await getCurrentSlugForAlias(potentialSlug);
          if (currentSlug && currentSlug !== potentialSlug) {
            const rewriteUrl = request.nextUrl.clone();
            const strippedApiPathname =
              pathname.slice(`/${potentialSlug}`.length) || '/';
            rewriteUrl.pathname = strippedApiPathname;
            const retired = potentialSlug.toLowerCase();
            for (const param of MERCHANT_SLUG_QUERY_PARAMS) {
              if (
                rewriteUrl.searchParams.get(param)?.toLowerCase() === retired
              ) {
                rewriteUrl.searchParams.set(param, currentSlug);
              }
            }
            const response = NextResponse.rewrite(rewriteUrl, {
              request: { headers: buildProxyRequestHeaders(request) },
            });

            return applySecurityHeaders(
              response,
              strippedApiPathname,
              userAgent,
              getRouteType(strippedApiPathname),
              isLocalhost(hostname),
              undefined,
              request,
              hostname
            );
          }
        } else {
          const reservedAliasNewPathname =
            pathname.replace(`/${potentialSlug}`, '') || '/';
          const reservedAliasRedirect = await resolveRetiredSlugRedirect(
            potentialSlug,
            normalizeStorefrontTermsAliasPath(reservedAliasNewPathname),
            request.nextUrl.search,
            request.method
          );
          if (reservedAliasRedirect) {
            return NextResponse.redirect(reservedAliasRedirect, 302);
          }
        }
      }

      if (
        isValidSubdomain(potentialSlug) &&
        !RESERVED_SUBDOMAINS.has(potentialSlug)
      ) {
        // Retired-alias redirect ONLY for non-platform segments: platform pages
        // (pricing, about, blog, ...) live at usebaci.com/<segment> and must never
        // be treated as a retired storefront alias. A TEMPORARY (302) redirect —
        // not 301 — because a merchant can rename BACK (A->B->A), and a browser-
        // cached permanent A->B would then loop against B's alias->A redirect.
        if (!PLATFORM_ROOT_ROUTE_SEGMENTS.has(potentialSlug.toLowerCase())) {
          // Root-path API call on a RETIRED alias (usebaci.com/<oldSlug>/api/...).
          // A cross-origin 302 to the current subdomain would drop the caller's
          // Bearer token / same-origin cookies and its POST body, so resolve the
          // alias and do a SAME-ORIGIN rewrite to /api/... with the merchant-slug
          // query params corrected to the current slug — mirroring the retired-
          // subdomain and custom-domain API branches. Only a genuine retired alias
          // (getCurrentSlugForAlias resolves) triggers this; /api handlers still do
          // their own auth, so this grants no extra access.
          if (pathSegments[1]?.toLowerCase() === 'api') {
            const currentSlug = await getCurrentSlugForAlias(potentialSlug);
            if (currentSlug && currentSlug !== potentialSlug) {
              const rewriteUrl = request.nextUrl.clone();
              const strippedApiPathname =
                pathname.slice(`/${potentialSlug}`.length) || '/';
              rewriteUrl.pathname = strippedApiPathname;
              const retired = potentialSlug.toLowerCase();
              for (const param of MERCHANT_SLUG_QUERY_PARAMS) {
                if (
                  rewriteUrl.searchParams.get(param)?.toLowerCase() === retired
                ) {
                  rewriteUrl.searchParams.set(param, currentSlug);
                }
              }
              const response = NextResponse.rewrite(rewriteUrl, {
                request: { headers: buildProxyRequestHeaders(request) },
              });
              // Wrap with the proxy security/cache headers (X-Content-Type-Options,
              // route-type, etc.), keyed off the STRIPPED /api path — matching the
              // subdomain and custom-domain API rewrite branches.
              return applySecurityHeaders(
                response,
                strippedApiPathname,
                userAgent,
                getRouteType(strippedApiPathname),
                isLocalhost(hostname),
                undefined,
                request,
                hostname
              );
            }
            // Not a retired alias (or unresolved): fall through — never 302 /api.
          } else {
            const aliasNewPathname =
              pathname.replace(`/${potentialSlug}`, '') || '/';
            const aliasRedirect = await resolveRetiredSlugRedirect(
              potentialSlug,
              normalizeStorefrontTermsAliasPath(aliasNewPathname),
              request.nextUrl.search,
              request.method
            );
            if (aliasRedirect) {
              return NextResponse.redirect(aliasRedirect, 302);
            }
          }
        }

        // Live custom-domain redirect applies to ANY valid slug — including one
        // that happens to equal a platform segment (e.g. a merchant slugged
        // "products") — since it is a real, live merchant with a custom domain.
        const customDomain = await getCustomDomainForSlug(potentialSlug);
        if (customDomain) {
          const newPathname = pathname.replace(`/${potentialSlug}`, '') || '/';
          const normalizedPathname =
            normalizeStorefrontTermsAliasPath(newPathname);
          const customDomainUrl = `https://${customDomain}${normalizedPathname}${request.nextUrl.search}`;
          return NextResponse.redirect(customDomainUrl, 301);
        }
      }
    }
  }

  if (
    (isRootDomain(hostname, ROOT_DOMAIN) || isVercelPreview(hostname)) &&
    !isLocalhost(hostname)
  ) {
    const pathSegments = pathname.split('/').filter(Boolean);
    if (
      pathSegments.length === 2 &&
      pathSegments[1]?.toLowerCase() === 'sitemap.xml' &&
      isValidSubdomain(pathSegments[0]) &&
      !RESERVED_SUBDOMAINS.has(pathSegments[0])
    ) {
      return buildStorefrontRootSitemapRewriteResponse({
        request,
        pathname,
        userAgent,
        hostname,
        routeIdentifier: pathSegments[0],
        merchantSlug: pathSegments[0],
      });
    }
  }

  // Crawl-budget hard-404 (PR-B §3.2) for slug-prefixed root-domain / preview
  // storefronts (`usebaci.com/{slug}/{category}/{product}`). Runs AFTER the
  // slug→custom-domain redirect above (so a slug with a custom domain 301s
  // instead of 404ing) and is gated to real storefront slugs — never main-app
  // routes. Platform hosts are slug-prefixed, so the helper strips the slug and
  // judges `{category}/{product}`. Fail-open as everywhere else.
  if (
    (isRootDomain(hostname, ROOT_DOMAIN) || isVercelPreview(hostname)) &&
    !isLocalhost(hostname)
  ) {
    const pathSegments = pathname.split('/').filter(Boolean);
    const slug = pathSegments[0];
    const isMainAppRoute =
      ROOT_DOMAIN_ONLY_MAIN_APP_ROUTES.some(
        (route) => pathname === route || pathname.startsWith(`${route}/`)
      ) || matchesMainAppRoute(pathname);
    if (
      slug &&
      !isMainAppRoute &&
      // Platform-owned root segments (about, pricing, products, blog, …) are not
      // storefront slugs — never run the membership check (or send the secret)
      // for them, even though they pass the generic subdomain-shape test.
      !PLATFORM_ROOT_ROUTE_SEGMENTS.has(slug.toLowerCase()) &&
      isValidSubdomain(slug) &&
      !RESERVED_SUBDOMAINS.has(slug)
    ) {
      const rootBlogPostHardStatus = await resolveStorefrontBlogPostHardStatus(
        request,
        pathname,
        hostname,
        userAgent,
        slug,
        `/${slug}`
      );
      if (rootBlogPostHardStatus) {
        return rootBlogPostHardStatus;
      }

      const rootBlogListingHardStatus =
        await resolveStorefrontBlogListingHardStatus(
          request,
          pathname,
          hostname,
          userAgent,
          slug,
          `/${slug}`
        );
      if (rootBlogListingHardStatus) {
        return rootBlogListingHardStatus;
      }

      const rootComparePageHardStatus =
        await resolveStorefrontComparePageHardStatus(
          request,
          pathname,
          hostname,
          userAgent,
          slug,
          `/${slug}`
        );
      if (rootComparePageHardStatus) {
        return rootComparePageHardStatus;
      }

      const rootPdpCanonicalRedirect =
        await resolveStorefrontPdpCanonicalRedirect(
          request,
          pathname,
          hostname,
          slug,
          `/${slug}`
        );
      if (rootPdpCanonicalRedirect.response) {
        return rootPdpCanonicalRedirect.response;
      }

      if (!rootPdpCanonicalRedirect.skipHardNotFound) {
        const rootPdpHardNotFound = await resolveStorefrontPdpHardNotFound(
          request,
          pathname,
          hostname,
          userAgent,
          slug
        );
        if (rootPdpHardNotFound) {
          return rootPdpHardNotFound;
        }
      }
    }
  }

  // Standard request - generate route-specific CSP
  const routeType = getRouteType(pathname);
  const isLocal = isLocalhost(hostname);

  if (shouldPartitionStorefrontMetadataCache(pathname, hostname, routeType)) {
    // Root-domain and preview storefront PDPs do not hit the custom-domain or
    // subdomain rewrite branches above, so apply the same hidden partition key
    // here instead of relying only on a Vary header that Next/Vercel may replace.
    const url = request.nextUrl.clone();
    setStorefrontMetadataCacheBucketSearchParam(url, request);

    const response = NextResponse.rewrite(url, {
      request: {
        headers: buildProxyRequestHeaders(request),
      },
    });

    return applySecurityHeaders(
      response,
      pathname,
      userAgent,
      routeType,
      isLocal,
      undefined,
      request,
      hostname
    );
  }

  if (shouldForwardStrictCspNonce(routeType)) {
    const { nonce, response } = buildStrictCspResponse(
      request,
      routeType,
      isLocal
    );

    return applySecurityHeaders(
      response,
      pathname,
      userAgent,
      routeType,
      isLocal,
      nonce,
      request,
      hostname
    );
  }

  const response = NextResponse.next();
  return applySecurityHeaders(
    response,
    pathname,
    userAgent,
    routeType,
    isLocal,
    undefined,
    request, // request drives storefront cache-control (query/auth-hint) checks
    hostname
  );
}

function applySecurityHeaders(
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
    let cacheKind: StorefrontDocumentCacheKind = 'non-cacheable';
    if (!hasAuthSessionHint && cacheable) {
      const cachePolicy = getStorefrontPublicCachePolicy(pathname, hostname);
      cacheKind = cachePolicy
        ? isStorefrontPdpDocument(pathname, hostname, routeType) ||
          !canUseLongDownstreamStorefrontCache(pathname, hostname, routeType)
          ? 'cacheable-self-healing'
          : 'cacheable'
        : 'cacheable-vercel-only';
    }
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

export const config = {
  matcher: [
    '/agent-commerce.json',
    '/agent-trust.json',
    // Next statically analyzes matcher values. Keep this literal in sync with
    // DEFAULT_POSTHOG_RELAY_PATH so relay static assets do not bypass header
    // stripping just because they end in .js/.css/.json.
    '/baci-relay/:path*',
    // Custom relay paths are runtime-configurable, while matcher values are
    // statically analyzed. Catch custom `/relay/static/*.js` and
    // `/relay/array/*.js` assets, but keep Next's own static chunks out of
    // middleware so critical JS/CSS does not pay proxy overhead on every page.
    '/((?!_next/static(?:/|$))(?:.+/)?(?:static|array)/.*)',
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - robots.txt (SEO file)
     * - ads.txt (host-aware Route Handler at app/ads.txt; bypasses middleware
     *   so it receives the original Host on every domain — same as robots.txt)
     * - sitemap.xml (SEO file)
     * - Static files with extensions (.svg, .png, .jpg, etc.)
     */
    '/((?!_next/image(?:/.*[^/])?$|_next/static(?:/.*[^/])?$|manifest\\.webmanifest$|robots\\.txt$|ads\\.txt$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|woff|woff2|ttf|eot|css|js|json)$|(?!favicon\\.ico$)(?!favicon\\.ico/$).+\\.ico$).*)',
  ],
};

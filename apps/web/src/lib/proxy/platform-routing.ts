import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  extractSubdomain,
  isLocalhost,
  isPlatformHost,
  isRootDomain,
  isValidSubdomain,
  isVercelPreview,
  normalizeHostname,
  RESERVED_SUBDOMAINS,
  ROOT_DOMAIN,
} from '@/lib/proxy/host';
import {
  buildMerchantFeedPassThroughResponse,
  INDEXNOW_KEY_PATH,
  toLlmApiPath,
} from '@/lib/proxy/machine-responses';
import {
  lowercaseStorefrontPathname,
  normalizeCacheSafeStorefrontPathname,
} from '@/lib/proxy/path-normalization';
import { resolveRetiredSlugRedirect } from '@/lib/proxy/retired-slug';
import {
  CASE_PRESERVING_PREFIXES,
  PLATFORM_ROOT_ROUTE_SEGMENTS,
  STATIC_FILES_REGEX,
} from '@/lib/proxy/routing-constants';
import {
  isPublicMachineReadablePath,
  matchesMainAppRoute,
} from '@/lib/proxy/routing-policy';
import { buildProxyRequestHeaders } from './request-headers';

// Lowercase ASCII without escapes cannot change under either normalizer.
const STOREFRONT_PATH_CANONICALIZATION_CANDIDATE = /[%A-Z\u0080-\uffff]/;

/** Runs the post-legacy platform-only and canonical path routing stage. */
export async function runPlatformRoutingStage(
  request: NextRequest,
  pathname: string,
  hostname: string,
  userAgent: string
): Promise<NextResponse | null> {
  if (
    pathname.startsWith('/.well-known/') &&
    !isPublicMachineReadablePath(pathname)
  ) {
    return NextResponse.next({
      request: { headers: buildProxyRequestHeaders(request) },
    });
  }
  if (isPlatformHost(hostname) && isPublicMachineReadablePath(pathname)) {
    return buildMerchantFeedPassThroughResponse({
      request,
      pathname,
      userAgent,
      hostname,
    });
  }
  if (pathname === '/llms.txt' || pathname === '/llms-full.txt') {
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
        if (aliasRedirect) return NextResponse.redirect(aliasRedirect, 302);
      }
    }
    return NextResponse.next({
      request: { headers: buildProxyRequestHeaders(request) },
    });
  }
  if (
    pathname === INDEXNOW_KEY_PATH &&
    (isRootDomain(hostname, ROOT_DOMAIN) || isVercelPreview(hostname))
  )
    return NextResponse.next({
      request: { headers: buildProxyRequestHeaders(request) },
    });

  if (
    isPlatformHost(hostname) &&
    pathname.endsWith('.md') &&
    !pathname.startsWith('/api') &&
    !pathname.startsWith('/_next')
  ) {
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length >= 1) {
      const slug = segments[0];
      const rest = pathname.slice(`/${slug}`.length);
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
        if (aliasRedirect) return NextResponse.redirect(aliasRedirect, 302);
      }
      const mdUrl = request.nextUrl.clone();
      mdUrl.pathname = toLlmApiPath(rest, slug);
      return NextResponse.rewrite(mdUrl, {
        request: { headers: buildProxyRequestHeaders(request) },
      });
    }
  }

  return null;
}

/** Prevents an async boundary on ordinary document and API requests. */
export function isPlatformSpecialRoutingEligible(
  pathname: string,
  hostname: string
): boolean {
  return (
    pathname.startsWith('/.well-known/') ||
    isPublicMachineReadablePath(pathname) ||
    pathname === '/llms.txt' ||
    pathname === '/llms-full.txt' ||
    pathname === INDEXNOW_KEY_PATH ||
    (isPlatformHost(hostname) && pathname.endsWith('.md'))
  );
}

/** Runs the synchronous canonical path and main-app host guards. */
export function runPlatformCanonicalRoutingStage(
  request: NextRequest,
  pathname: string,
  hostname: string
): NextResponse | null {
  const lowerPathname = pathname.toLowerCase();
  const hasCanonicalizationCandidate =
    STOREFRONT_PATH_CANONICALIZATION_CANDIDATE.test(pathname);
  const isWellKnownPassthrough = lowerPathname.startsWith('/.well-known/');
  const isLlmsPassthrough =
    lowerPathname === '/llms.txt' || lowerPathname === '/llms-full.txt';
  const isStaticFile = STATIC_FILES_REGEX.test(lowerPathname);
  const isNonStorefrontPrefix = CASE_PRESERVING_PREFIXES.some(
    (prefix) =>
      lowerPathname === prefix || lowerPathname.startsWith(`${prefix}/`)
  );
  const cacheSafeStorefrontPathname = hasCanonicalizationCandidate
    ? normalizeCacheSafeStorefrontPathname(new URL(request.url).pathname)
    : null;
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
  const normalizedStorefrontPathname = hasCanonicalizationCandidate
    ? lowercaseStorefrontPathname(pathname)
    : pathname;
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
  return platformRouteSubdomain && matchesMainAppRoute(pathname)
    ? NextResponse.redirect(new URL(pathname, `https://${ROOT_DOMAIN}`))
    : null;
}

import { type NextRequest, NextResponse } from 'next/server';
import {
  getApiSecurityContext,
  runApiSecurityStage,
} from '@/lib/proxy/api-security';
import { resolveCustomDomainContext } from '@/lib/proxy/custom-domain-context';
import { runCustomDomainRouting } from '@/lib/proxy/custom-domain-routing';
import { buildFinalProxyResponse } from '@/lib/proxy/final-response';
import {
  isRootDomain,
  isValidCustomDomain,
  isVercelPreview,
  normalizeHostname,
  ROOT_DOMAIN,
} from '@/lib/proxy/host';
import { runLegacyRoutingStage } from '@/lib/proxy/legacy-routing';
import { buildPostHogRelayPassThroughResponse } from '@/lib/proxy/machine-responses';
import {
  getNoTrailingSlashRedirectPath,
  normalizeLeadingPrefix,
} from '@/lib/proxy/path-normalization';
import {
  isPlatformSpecialRoutingEligible,
  runPlatformCanonicalRoutingStage,
  runPlatformRoutingStage,
} from '@/lib/proxy/platform-routing';
import {
  isPostHogRelayPath,
  isStaticAssetOutsidePostHogRelay,
} from '@/lib/proxy/posthog-relay';
import { CASE_PRESERVING_PREFIXES } from '@/lib/proxy/routing-constants';
import {
  isSessionRoutingEligible,
  runSessionRoutingStage,
} from '@/lib/proxy/session-routing';
import { runSlugRoutingStage } from '@/lib/proxy/slug-routing';
import {
  getRequestSubdomain,
  runSubdomainRouting,
} from '@/lib/proxy/subdomain-routing';

/** Coordinates ordered proxy stages; each stage owns its former early returns. */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const hostname = request.headers.get('host') || '';
  const userAgent = request.headers.get('user-agent') || '';
  const pathname = request.nextUrl.pathname;

  if (isStaticAssetOutsidePostHogRelay(pathname)) return NextResponse.next();
  if (isPostHogRelayPath(pathname)) {
    return buildPostHogRelayPassThroughResponse(
      request,
      pathname,
      userAgent,
      hostname
    );
  }

  for (const prefix of CASE_PRESERVING_PREFIXES) {
    const normalized = normalizeLeadingPrefix(pathname, prefix);
    if (normalized) {
      return NextResponse.redirect(
        new URL(normalized + request.nextUrl.search, request.url),
        308
      );
    }
  }

  const apiSecurityContext = getApiSecurityContext(
    pathname,
    hostname,
    request.method
  );
  const noTrailingSlashPathname =
    apiSecurityContext.isLegacyKlumpWebhook ||
    apiSecurityContext.isLegacyAnalyticsConversionPost ||
    normalizeHostname(hostname) === 'blog.ogabassey.com'
      ? null
      : getNoTrailingSlashRedirectPath(pathname);
  if (noTrailingSlashPathname) {
    return NextResponse.redirect(
      new URL(noTrailingSlashPathname + request.nextUrl.search, request.url),
      308
    );
  }

  if (
    apiSecurityContext.apiRateLimitPathname.startsWith('/api') ||
    (apiSecurityContext.isAliasApiShaped && apiSecurityContext.aliasApiShape)
  ) {
    const response = await runApiSecurityStage(request, apiSecurityContext);
    if (response) return response;
  }

  const legacyResponse = runLegacyRoutingStage(
    request,
    pathname,
    hostname,
    userAgent
  );
  if (legacyResponse) return legacyResponse;

  if (isPlatformSpecialRoutingEligible(pathname, hostname)) {
    const response = await runPlatformRoutingStage(
      request,
      pathname,
      hostname,
      userAgent
    );
    if (response) return response;
  }
  const platformResponse = runPlatformCanonicalRoutingStage(
    request,
    pathname,
    hostname
  );
  if (platformResponse) return platformResponse;

  if (isSessionRoutingEligible(pathname)) {
    const response = await runSessionRoutingStage(
      request,
      pathname,
      hostname,
      userAgent
    );
    if (response) return response;
  }

  const subdomain = getRequestSubdomain(hostname);
  if (subdomain) {
    const response = await runSubdomainRouting(
      request,
      pathname,
      hostname,
      userAgent,
      subdomain
    );
    if (response) return response;
  } else if (
    !isRootDomain(hostname, ROOT_DOMAIN) &&
    !isVercelPreview(hostname) &&
    isValidCustomDomain(hostname)
  ) {
    const context = await resolveCustomDomainContext(request, hostname);
    if (context) {
      return runCustomDomainRouting(
        request,
        pathname,
        hostname,
        userAgent,
        context
      );
    }
  }

  const slugResponse = await runSlugRoutingStage(
    request,
    pathname,
    hostname,
    userAgent
  );
  if (slugResponse) return slugResponse;

  return buildFinalProxyResponse(request, pathname, hostname, userAgent);
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

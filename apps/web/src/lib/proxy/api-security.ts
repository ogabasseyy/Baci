import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  ANALYTICS_CONVERSION_API_PATH,
  isAliasApiShapedOnRewritableHost,
  isLegacyAnalyticsConversionPath,
  isLegacyKlumpWooCommerceWebhookPath,
  KLUMP_WEBHOOK_API_PATH,
  matchAliasApiPrefixShape,
} from '@/lib/proxy/api-alias';
import {
  getSlugForOriginCustomDomain,
  isLocalhost,
  isVercelPreview,
  ROOT_DOMAIN,
} from '@/lib/proxy/host';
import { isAuthenticatedInternalRequest } from '@/lib/proxy/request-classification';
import { checkRateLimit, createRateLimitResponse } from '@/lib/rate-limit';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';

export type ApiSecurityContext = {
  isLegacyAnalyticsConversionPost: boolean;
  isLegacyKlumpWebhook: boolean;
  aliasApiShape: ReturnType<typeof matchAliasApiPrefixShape>;
  isAliasApiShaped: boolean;
  apiRateLimitPathname: string;
};

/** Computes only synchronous API-routing facts, before any alias lookup. */
export function getApiSecurityContext(
  pathname: string,
  hostname: string,
  method: string
): ApiSecurityContext {
  const isLegacyAnalyticsConversionPost =
    isLegacyAnalyticsConversionPath(pathname) && method === 'POST';
  const isLegacyKlumpWebhook = isLegacyKlumpWooCommerceWebhookPath(pathname);
  const aliasApiShape = matchAliasApiPrefixShape(pathname);
  const isAliasApiShaped = isAliasApiShapedOnRewritableHost(
    hostname,
    aliasApiShape
  );
  const apiRateLimitPathname = isLegacyKlumpWebhook
    ? KLUMP_WEBHOOK_API_PATH
    : isLegacyAnalyticsConversionPost
      ? ANALYTICS_CONVERSION_API_PATH
      : isAliasApiShaped && aliasApiShape
        ? aliasApiShape.apiPathname
        : pathname;
  return {
    isLegacyAnalyticsConversionPost,
    isLegacyKlumpWebhook,
    aliasApiShape,
    isAliasApiShaped,
    apiRateLimitPathname,
  };
}

/**
 * Preserves the alias-shaped API guard order: rate limiting happens before the
 * confirmed alias lookup, and validation applies only to the confirmed path.
 */
export async function runApiSecurityStage(
  request: NextRequest,
  context: ApiSecurityContext
): Promise<NextResponse | null> {
  const { apiRateLimitPathname, aliasApiShape, isAliasApiShaped } = context;
  if (apiRateLimitPathname.startsWith('/api')) {
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

  let apiSecurityPathname = apiRateLimitPathname;
  if (isAliasApiShaped && aliasApiShape) {
    const confirmedAliasSlug = await getCurrentSlugForAlias(
      aliasApiShape.prefix
    );
    apiSecurityPathname = confirmedAliasSlug
      ? aliasApiShape.apiPathname
      : request.nextUrl.pathname;
  }
  if (!apiSecurityPathname.startsWith('/api')) return null;

  const method = request.method;
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    const contentLength = request.headers.get('content-length');
    if (contentLength && Number.parseInt(contentLength, 10) > 2 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'Payload too large', maxSize: '2MB' },
        { status: 413 }
      );
    }
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

  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return null;
  const isBearerAuth = request.headers
    .get('Authorization')
    ?.startsWith('Bearer ');
  const isPaymentWebhook = /^\/api\/payments\/[^/]+\/webhook$/.test(
    apiSecurityPathname
  );
  const isWebhook =
    apiSecurityPathname.startsWith('/api/webhooks/') || isPaymentWebhook;
  const isAuthCallback = apiSecurityPathname.startsWith('/api/auth/');
  const isCron = apiSecurityPathname.startsWith('/api/cron/');
  const isPublicAnalytics = apiSecurityPathname === '/api/platform/events';
  if (
    isBearerAuth ||
    isWebhook ||
    isAuthCallback ||
    isCron ||
    isPublicAnalytics
  ) {
    return null;
  }
  const origin = request.headers.get('origin');
  if (!origin) return null;
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
  const isAllowed =
    originHostname === normalizedRoot ||
    originHostname.endsWith(`.${normalizedRoot}`) ||
    isLocalhost(originHostname) ||
    isVercelPreview(originHostname);
  if (isAllowed) return null;
  const customSlug = await getSlugForOriginCustomDomain(originHostname);
  return customSlug
    ? null
    : NextResponse.json(
        { error: 'Cross-origin request blocked' },
        { status: 403 }
      );
}

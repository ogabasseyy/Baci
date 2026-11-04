import { type NextRequest, NextResponse } from 'next/server';
import {
  buildStrictCspResponse,
  shouldForwardStrictCspNonce,
} from '@/lib/proxy/csp';
import { isLocalhost } from '@/lib/proxy/host';
import {
  buildProxyRequestHeaders,
  setStorefrontMetadataCacheBucketSearchParam,
} from '@/lib/proxy/request-headers';
import { applySecurityHeaders } from '@/lib/proxy/response-headers';
import {
  getRouteType,
  shouldPartitionStorefrontMetadataCache,
} from '@/lib/proxy/routing-policy';
import { isRootDomain, isVercelPreview, ROOT_DOMAIN } from './host';
import { applyOwnedOxygenDocumentPolicy } from './oxygen-owned-document';

/** Decorates the final no-host-routing response without changing its prior order. */
function buildFinalProxyResponseInternal(
  request: NextRequest,
  pathname: string,
  hostname: string,
  userAgent: string
): NextResponse {
  const routeType = getRouteType(pathname);
  const isLocal = isLocalhost(hostname);
  // Dev loopback has no CDN cache to partition. Next normalizes numeric
  // loopback rewrite targets to localhost and externally self-proxies them.
  // Keep verified request headers below without introducing that extra hop.
  const devLoopback = isLocal && process.env.NODE_ENV !== 'production';
  if (
    !devLoopback &&
    shouldPartitionStorefrontMetadataCache(pathname, hostname, routeType)
  ) {
    const url = request.nextUrl.clone();
    setStorefrontMetadataCacheBucketSearchParam(url, request);
    return applySecurityHeaders(
      NextResponse.rewrite(url, {
        request: { headers: buildProxyRequestHeaders(request) },
      }),
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
  return applySecurityHeaders(
    NextResponse.next({
      request: { headers: buildProxyRequestHeaders(request) },
    }),
    pathname,
    userAgent,
    routeType,
    isLocal,
    undefined,
    request,
    hostname
  );
}

export function buildFinalProxyResponse(
  request: NextRequest,
  pathname: string,
  hostname: string,
  userAgent: string
): Promise<NextResponse> {
  const response = buildFinalProxyResponseInternal(
    request,
    pathname,
    hostname,
    userAgent
  );
  const segments = pathname.split('/').filter(Boolean);
  const platform =
    isRootDomain(hostname, ROOT_DOMAIN) ||
    isVercelPreview(hostname) ||
    isLocalhost(hostname);
  const slug =
    platform && segments.length === 2 && segments[1] === 'checkout'
      ? segments[0]
      : null;
  return applyOwnedOxygenDocumentPolicy(
    response,
    request,
    pathname,
    hostname,
    userAgent,
    slug
  );
}

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

/** Decorates the final no-host-routing response without changing its prior order. */
export function buildFinalProxyResponse(
  request: NextRequest,
  pathname: string,
  hostname: string,
  userAgent: string
): NextResponse {
  const routeType = getRouteType(pathname);
  const isLocal = isLocalhost(hostname);
  if (shouldPartitionStorefrontMetadataCache(pathname, hostname, routeType)) {
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
    NextResponse.next(),
    pathname,
    userAgent,
    routeType,
    isLocal,
    undefined,
    request,
    hostname
  );
}

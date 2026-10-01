import type { NextRequest, NextResponse } from 'next/server';
import {
  getStorefrontForwardedBotUserAgent,
  getStorefrontMetadataCacheBucket,
  STOREFRONT_METADATA_CACHE_BUCKET_HEADER,
  STOREFRONT_METADATA_CACHE_BUCKET_QUERY_PARAM,
} from '@/config/storefront-metadata-cache-bots';

export const POSTHOG_RELAY_CREDENTIAL_HEADERS = [
  'authorization',
  'cookie',
  'proxy-authorization',
  'referer',
  'x-csrf-token',
  'x-supabase-auth-token',
] as const;

export const MERCHANT_CONTEXT_HEADERS = [
  'x-custom-domain',
  'x-merchant-domain',
  'x-merchant-slug',
] as const;

export function appendVaryHeader(response: NextResponse, value: string): void {
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

export function buildProxyRequestHeaders(request: NextRequest): Headers {
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

export function buildPostHogRelayRequestHeaders(request: NextRequest): Headers {
  const headers = buildProxyRequestHeaders(request);
  for (const header of POSTHOG_RELAY_CREDENTIAL_HEADERS) {
    headers.delete(header);
  }
  return headers;
}

export function setStorefrontMetadataCacheBucketSearchParam(
  url: URL,
  request: NextRequest
): void {
  url.searchParams.set(
    STOREFRONT_METADATA_CACHE_BUCKET_QUERY_PARAM,
    getStorefrontMetadataCacheBucket(request.headers.get('user-agent') ?? '')
  );
}

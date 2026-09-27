import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';
import {
  appendVaryHeader,
  buildPostHogRelayRequestHeaders,
  buildProxyRequestHeaders,
  setStorefrontMetadataCacheBucketSearchParam,
} from './request-headers';

describe('proxy request headers', () => {
  it('removes caller-supplied merchant context before forwarding', () => {
    const request = new NextRequest('https://shop.example', {
      headers: { 'x-merchant-slug': 'attacker', authorization: 'Bearer token' },
    });
    const headers = buildProxyRequestHeaders(request);
    expect(headers.get('x-merchant-slug')).toBeNull();
    expect(
      buildPostHogRelayRequestHeaders(request).get('authorization')
    ).toBeNull();
  });

  it('deduplicates vary values and writes a metadata cache bucket', () => {
    const response = NextResponse.next({ headers: { Vary: 'Accept, Cookie' } });
    appendVaryHeader(response, 'cookie');
    appendVaryHeader(response, 'X-Baci-Storefront-Metadata-Bucket');
    expect(response.headers.get('Vary')).toBe(
      'Accept, Cookie, X-Baci-Storefront-Metadata-Bucket'
    );
    const url = new URL('https://shop.example/products');
    setStorefrontMetadataCacheBucketSearchParam(url, new NextRequest(url));
    expect(url.search).toContain('__baci_metadata_cache_bucket=');
  });
});

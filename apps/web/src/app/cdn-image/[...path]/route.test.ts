import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { fetchSameOriginOgabasseyImageResponse } from '@/lib/ogabassey-same-origin-cdn-image';
import { ogabasseyCdnImageProxyPathSchema } from '@/schemas/ogabassey-cdn-image-proxy';
import { GET } from './route';

describe('/cdn-image/[...path] same-origin route and 20 KB AVIF step-down', () => {
  it('rejects malformed options, untrusted asset paths, or non-allowlisted query params with 400', async () => {
    for (const invalidPath of [
      ['width=384,quality=70,format=avif', '../secret.avif'],
      ['width=384,quality=70,format=avif', 'other-bucket', 'item.avif'],
      ['width=384,quality=70,format=svg', 'core-assets', 'products', 'a.svg'],
      ['malformed-token', 'core-assets', 'products', 'a.avif'],
    ]) {
      const response = await GET(
        new NextRequest('https://ogabassey.com/cdn-image/test'),
        { params: Promise.resolve({ path: invalidPath }) }
      );
      expect(response.status).toBe(400);
    }

    for (const query of [
      'bust=1',
      'v=1&v=2',
      'v=a%20b',
      `v=${'a'.repeat(65)}`,
    ]) {
      const queryResponse = await GET(
        new NextRequest(`https://ogabassey.com/cdn-image/test?${query}`),
        {
          params: Promise.resolve({
            path: [
              'width=384,quality=70,format=avif',
              'core-assets',
              'products',
              'itel-battery.avif',
            ],
          }),
        }
      );
      expect(queryResponse.status).toBe(400);
    }
  });

  it('returns a fitting quality=70 AVIF immediately without waiting for pending lower-quality variants', async () => {
    const parsed = ogabasseyCdnImageProxyPathSchema.parse([
      'width=384,quality=70,format=avif',
      'core-assets',
      'products',
      'itel-battery.avif',
    ]);
    const calls: string[] = [];
    const neverResolvingPromise = new Promise<Response>(() => undefined);
    const fakeFetcher: typeof fetch = vi.fn((input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('quality=70')) {
        return Promise.resolve(
          new Response(new Uint8Array(16_593), {
            headers: { 'content-type': 'image/avif' },
            status: 200,
          })
        );
      }
      return neverResolvingPromise;
    });

    const response = await fetchSameOriginOgabasseyImageResponse(
      parsed,
      fakeFetcher,
      new URLSearchParams('v=20260927')
    );
    expect(response.status).toBe(200);
    expect(calls[0]).toBe(
      'https://cdn.ogabassey.com/image/width=384,quality=70,format=avif/core-assets/products/itel-battery.avif?v=20260927'
    );
    expect(response.headers.get('X-Hero-Effective-Quality')).toBe('70');
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=31536000, s-maxage=31536000, immutable'
    );
    expect((await response.arrayBuffer()).byteLength).toBe(16_593);
  });

  it('selects quality=60 when quality=70 exceeds 20,000 bytes without waiting for a pending quality=50', async () => {
    const parsed = ogabasseyCdnImageProxyPathSchema.parse([
      'width=384,quality=70,format=avif',
      'core-assets',
      'products',
      'detailed-hero.avif',
    ]);
    const neverResolvingPromise = new Promise<Response>(() => undefined);
    const fakeFetcher: typeof fetch = vi.fn((input) => {
      const url = String(input);
      if (url.includes('quality=70')) {
        return Promise.resolve(
          new Response(new Uint8Array(24_800), {
            headers: { 'content-type': 'image/avif' },
            status: 200,
          })
        );
      }
      if (url.includes('quality=60')) {
        return Promise.resolve(
          new Response(new Uint8Array(18_200), {
            headers: { 'content-type': 'image/avif' },
            status: 200,
          })
        );
      }
      return neverResolvingPromise;
    });

    const response = await fetchSameOriginOgabasseyImageResponse(
      parsed,
      fakeFetcher
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Hero-Effective-Quality')).toBe('60');
    expect((await response.arrayBuffer()).byteLength).toBe(18_200);
  });

  it('streams non-byte-capped desktop requests directly without buffering arrayBuffer()', async () => {
    const parsed = ogabasseyCdnImageProxyPathSchema.parse([
      'width=640,quality=70,format=avif',
      'core-assets',
      'products',
      'desktop-hero.avif',
    ]);
    const upstreamResponse = new Response(new Uint8Array(45_000), {
      headers: {
        'content-length': '45000',
        'content-type': 'image/avif',
      },
      status: 200,
    });
    const arrayBufferSpy = vi.spyOn(upstreamResponse, 'arrayBuffer');
    const fakeFetcher: typeof fetch = vi.fn(async () => upstreamResponse);

    const response = await fetchSameOriginOgabasseyImageResponse(
      parsed,
      fakeFetcher
    );
    expect(response.status).toBe(200);
    expect(arrayBufferSpy).not.toHaveBeenCalled();
    expect(response.headers.get('Content-Length')).toBe('45000');
  });

  it('still serves a valid candidate when a higher-quality rung fails', async () => {
    const parsed = ogabasseyCdnImageProxyPathSchema.parse([
      'width=384,quality=70,format=avif',
      'core-assets',
      'products',
      'resilient-hero.avif',
    ]);
    const fakeFetcher: typeof fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes('quality=70')) {
        throw new Error('transient upstream timeout');
      }
      return new Response(new Uint8Array(15_400), {
        headers: { 'content-type': 'image/avif' },
        status: 200,
      });
    });

    const response = await fetchSameOriginOgabasseyImageResponse(
      parsed,
      fakeFetcher
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Hero-Effective-Quality')).toBe('60');
  });
});

import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { fetchSameOriginOgabasseyImageResponse } from '@/lib/ogabassey-same-origin-cdn-image';
import { ogabasseyCdnImageProxyPathSchema } from '@/schemas/ogabassey-cdn-image-proxy';
import { GET } from './route';

describe('/cdn-image/[...path] same-origin route and 20 KB AVIF step-down', () => {
  it('rejects malformed options or untrusted asset paths with 400', async () => {
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
  });

  it('serves a 384w AVIF image at quality=70 when <= 20,000 bytes and forwards version query params', async () => {
    const parsed = ogabasseyCdnImageProxyPathSchema.parse([
      'width=384,quality=70,format=avif',
      'core-assets',
      'products',
      'itel-battery.avif',
    ]);
    const calls: string[] = [];
    const fakeFetcher: typeof fetch = vi.fn(async (input) => {
      calls.push(String(input));
      return new Response(new Uint8Array(16_593), {
        headers: { 'content-type': 'image/avif' },
        status: 200,
      });
    });

    const response = await fetchSameOriginOgabasseyImageResponse(
      parsed,
      fakeFetcher,
      new URLSearchParams('v=20260927')
    );
    expect(response.status).toBe(200);
    expect(calls).toEqual([
      'https://cdn.ogabassey.com/image/width=384,quality=70,format=avif/core-assets/products/itel-battery.avif?v=20260927',
      'https://cdn.ogabassey.com/image/width=384,quality=60,format=avif/core-assets/products/itel-battery.avif?v=20260927',
      'https://cdn.ogabassey.com/image/width=384,quality=50,format=avif/core-assets/products/itel-battery.avif?v=20260927',
    ]);
    expect(response.headers.get('X-Hero-Effective-Quality')).toBe('70');
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=31536000, s-maxage=31536000, immutable'
    );
    expect((await response.arrayBuffer()).byteLength).toBe(16_593);
  });

  it('selects quality=60 concurrently when quality=70 exceeds 20,000 bytes', async () => {
    const parsed = ogabasseyCdnImageProxyPathSchema.parse([
      'width=384,quality=70,format=avif',
      'core-assets',
      'products',
      'detailed-hero.avif',
    ]);
    const calls: string[] = [];
    const sizesByQuality: Record<string, number> = {
      'quality=70': 24_800,
      'quality=60': 18_200,
      'quality=50': 14_100,
    };
    const fakeFetcher: typeof fetch = vi.fn(async (input) => {
      const url = String(input);
      calls.push(url);
      const matchedSize =
        Object.entries(sizesByQuality).find(([token]) =>
          url.includes(token)
        )?.[1] ?? 15_000;
      return new Response(new Uint8Array(matchedSize), {
        headers: { 'content-type': 'image/avif' },
        status: 200,
      });
    });

    const response = await fetchSameOriginOgabasseyImageResponse(
      parsed,
      fakeFetcher
    );
    expect(response.status).toBe(200);
    expect(calls).toEqual([
      'https://cdn.ogabassey.com/image/width=384,quality=70,format=avif/core-assets/products/detailed-hero.avif',
      'https://cdn.ogabassey.com/image/width=384,quality=60,format=avif/core-assets/products/detailed-hero.avif',
      'https://cdn.ogabassey.com/image/width=384,quality=50,format=avif/core-assets/products/detailed-hero.avif',
    ]);
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

  it('still serves a valid candidate when another concurrent quality rung fails', async () => {
    const parsed = ogabasseyCdnImageProxyPathSchema.parse([
      'width=384,quality=70,format=avif',
      'core-assets',
      'products',
      'resilient-hero.avif',
    ]);
    const fakeFetcher: typeof fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes('quality=50')) {
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
    expect(response.headers.get('X-Hero-Effective-Quality')).toBe('70');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { fetchSameOriginOgabasseyImageResponse } from './ogabassey-same-origin-cdn-image';

describe('fetchSameOriginOgabasseyImageResponse response hardening', () => {
  const desktopRequest = {
    assetPath: 'core-assets/products/desktop-hero.avif',
    options: {
      fit: 'inside' as const,
      format: 'avif' as const,
      quality: 70,
      width: 640,
    },
  };
  const mobileRequest = {
    ...desktopRequest,
    options: { ...desktopRequest.options, width: 384 },
  };

  it.each([
    'text/html',
    'image/svg+xml',
    'application/octet-stream',
  ])('rejects a streamed upstream %s body with 502 instead of serving it from the storefront origin', async (contentType) => {
    const fetcher: typeof fetch = vi.fn(
      async () =>
        new Response('<svg><script>alert(1)</script></svg>', {
          headers: { 'content-type': contentType },
          status: 200,
        })
    );

    const response = await fetchSameOriginOgabasseyImageResponse(
      desktopRequest,
      fetcher
    );

    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).not.toContain('immutable');
  });

  it('rejects quality-ladder candidates whose upstream type is not an allowed raster image', async () => {
    const fetcher: typeof fetch = vi.fn(
      async () =>
        new Response(new Uint8Array(8_000), {
          headers: { 'content-type': 'image/svg+xml' },
          status: 200,
        })
    );

    const response = await fetchSameOriginOgabasseyImageResponse(
      mobileRequest,
      fetcher
    );

    expect(response.status).toBe(502);
  });

  it('accepts an allowed upstream image type with parameters and mixed case', async () => {
    const fetcher: typeof fetch = vi.fn(
      async () =>
        new Response(new Uint8Array(8_000), {
          headers: { 'content-type': 'Image/AVIF; charset=binary' },
          status: 200,
        })
    );

    const response = await fetchSameOriginOgabasseyImageResponse(
      desktopRequest,
      fetcher
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/avif');
  });

  it('drops the upstream Content-Length when the streamed body was content-encoded', async () => {
    const fetcher: typeof fetch = vi.fn(
      async () =>
        new Response(new Uint8Array(32_000), {
          headers: {
            'content-encoding': 'gzip',
            'content-length': '9000',
            'content-type': 'image/avif',
          },
          status: 200,
        })
    );

    const response = await fetchSameOriginOgabasseyImageResponse(
      desktopRequest,
      fetcher
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Length')).toBeNull();
  });

  it('keeps the upstream Content-Length for an identity-encoded streamed body', async () => {
    const fetcher: typeof fetch = vi.fn(
      async () =>
        new Response(new Uint8Array(32_000), {
          headers: { 'content-length': '32000', 'content-type': 'image/avif' },
          status: 200,
        })
    );

    const response = await fetchSameOriginOgabasseyImageResponse(
      desktopRequest,
      fetcher
    );

    expect(response.headers.get('Content-Length')).toBe('32000');
  });

  it.each([
    ['streamed', desktopRequest],
    ['quality-ladder', mobileRequest],
  ])('rejects a %s upstream image whose type differs from the requested format', async (_path, request) => {
    const fetcher: typeof fetch = vi.fn(
      async () =>
        new Response(new Uint8Array(8_000), {
          headers: { 'content-type': 'image/webp' },
          status: 200,
        })
    );

    const response = await fetchSameOriginOgabasseyImageResponse(
      request,
      fetcher
    );

    expect(response.status).toBe(502);
  });

  it('rejects an empty upstream Content-Type instead of treating it as missing', async () => {
    const fetcher: typeof fetch = vi.fn(
      async () =>
        new Response(new Uint8Array(8_000), {
          headers: { 'content-type': ' ' },
          status: 200,
        })
    );

    const response = await fetchSameOriginOgabasseyImageResponse(
      desktopRequest,
      fetcher
    );

    expect(response.status).toBe(502);
  });

  it.each([
    ['streamed', desktopRequest],
    ['quality-ladder', mobileRequest],
  ])('sandboxes the %s image response with a restrictive CSP', async (_path, request) => {
    const fetcher: typeof fetch = vi.fn(
      async () =>
        new Response(new Uint8Array(8_000), {
          headers: { 'content-type': 'image/avif' },
          status: 200,
        })
    );

    const response = await fetchSameOriginOgabasseyImageResponse(
      request,
      fetcher
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Security-Policy')).toBe(
      "default-src 'none'; sandbox"
    );
  });
});

import { describe, expect, it, vi } from 'vitest';
import { fetchSameOriginOgabasseyImageResponse } from './ogabassey-same-origin-cdn-image';

describe('fetchSameOriginOgabasseyImageResponse', () => {
  it('constructs upstream CDN URLs with encoded asset segments and allowlisted v query param', async () => {
    const calls: string[] = [];
    const fakeFetcher: typeof fetch = vi.fn(async (input) => {
      calls.push(String(input));
      return new Response(new Uint8Array(12_000), {
        headers: { 'content-type': 'image/jpeg' },
        status: 200,
      });
    });

    const response = await fetchSameOriginOgabasseyImageResponse(
      {
        assetPath: 'core-assets/products/phone#red 5g.jpg',
        options: {
          fit: 'inside',
          format: 'jpeg',
          quality: 70,
          width: 384,
        },
      },
      fakeFetcher,
      new URLSearchParams('v=20260927&bust=123')
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      'https://cdn.ogabassey.com/image/width=384,quality=70,format=jpeg/core-assets/products/phone%23red%205g.jpg?v=20260927',
    ]);
  });

  it('evaluates the 70 -> 60 -> 50 quality ladder for <=384w AVIF and single quality for wider variants', async () => {
    const mobileCalls: string[] = [];
    const mobileFetcher: typeof fetch = vi.fn(async (input) => {
      const url = String(input);
      mobileCalls.push(url);
      const size = url.includes('quality=70') ? 24_000 : 15_000;
      return new Response(new Uint8Array(size), {
        headers: { 'content-type': 'image/avif' },
        status: 200,
      });
    });

    const mobileResponse = await fetchSameOriginOgabasseyImageResponse(
      {
        assetPath: 'core-assets/products/redmi.avif',
        options: {
          fit: 'inside',
          format: 'avif',
          quality: 70,
          width: 384,
        },
      },
      mobileFetcher
    );

    expect(mobileResponse.status).toBe(200);
    expect(mobileResponse.headers.get('X-Hero-Effective-Quality')).toBe('60');
    expect(mobileCalls).toEqual([
      'https://cdn.ogabassey.com/image/width=384,quality=70,format=avif/core-assets/products/redmi.avif',
      'https://cdn.ogabassey.com/image/width=384,quality=60,format=avif/core-assets/products/redmi.avif',
      'https://cdn.ogabassey.com/image/width=384,quality=50,format=avif/core-assets/products/redmi.avif',
    ]);

    const desktopCalls: string[] = [];
    const desktopFetcher: typeof fetch = vi.fn(async (input) => {
      desktopCalls.push(String(input));
      return new Response(new Uint8Array(35_000), {
        headers: { 'content-type': 'image/avif' },
        status: 200,
      });
    });

    const desktopResponse = await fetchSameOriginOgabasseyImageResponse(
      {
        assetPath: 'core-assets/products/redmi.avif',
        options: {
          fit: 'inside',
          format: 'avif',
          quality: 70,
          width: 640,
        },
      },
      desktopFetcher
    );

    expect(desktopResponse.status).toBe(200);
    expect(desktopCalls).toEqual([
      'https://cdn.ogabassey.com/image/width=640,quality=70,format=avif/core-assets/products/redmi.avif',
    ]);
  });

  it('attaches an AbortSignal to both single-quality and multi-quality upstream fetch calls and downgrades cache TTL when a candidate fails transiently', async () => {
    const signals: Array<AbortSignal | null | undefined> = [];
    const transientFetcher: typeof fetch = vi.fn(async (input, init) => {
      signals.push(init?.signal);
      if (String(input).includes('quality=70')) {
        return new Response('Bad Gateway', { status: 502 });
      }
      return new Response(new Uint8Array(14_000), {
        headers: { 'content-type': 'image/avif' },
        status: 200,
      });
    });

    const response = await fetchSameOriginOgabasseyImageResponse(
      {
        assetPath: 'core-assets/products/redmi.avif',
        options: {
          fit: 'inside',
          format: 'avif',
          quality: 70,
          width: 384,
        },
      },
      transientFetcher
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Hero-Effective-Quality')).toBe('60');
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=60, s-maxage=60'
    );
    expect(response.headers.get('CDN-Cache-Control')).toBe(
      'public, max-age=60'
    );
    expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
  });

  it('clears the header timeout once single-quality upstream headers arrive so a streamed body is not aborted after 5 seconds', async () => {
    vi.useFakeTimers();
    try {
      let capturedSignal: AbortSignal | null | undefined;
      const streamingFetcher: typeof fetch = vi.fn(async (_input, init) => {
        capturedSignal = init?.signal;
        return new Response(new Uint8Array(32_000), {
          headers: { 'content-type': 'image/avif' },
          status: 200,
        });
      });

      const response = await fetchSameOriginOgabasseyImageResponse(
        {
          assetPath: 'core-assets/products/desktop-hero.avif',
          options: {
            fit: 'inside',
            format: 'avif',
            quality: 70,
            width: 640,
          },
        },
        streamingFetcher
      );

      expect(response.status).toBe(200);
      vi.advanceTimersByTime(10_000);
      expect(capturedSignal?.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts the mobile AVIF ladder at the requested quality before stepping down to lower rungs', async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = vi.fn(async (input) => {
      calls.push(String(input));
      return new Response(new Uint8Array(15_000), {
        headers: { 'content-type': 'image/avif' },
        status: 200,
      });
    });

    const response = await fetchSameOriginOgabasseyImageResponse(
      {
        assetPath: 'core-assets/products/custom-q.avif',
        options: {
          fit: 'inside',
          format: 'avif',
          quality: 65,
          width: 384,
        },
      },
      fetcher
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Hero-Effective-Quality')).toBe('65');
    expect(calls[0]).toContain('quality=65');
  });
});

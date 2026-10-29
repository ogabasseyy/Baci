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
});

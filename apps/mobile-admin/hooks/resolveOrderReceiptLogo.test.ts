import { fetch } from 'expo/fetch';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveOrderReceiptLogo } from './resolveOrderReceiptLogo';

vi.mock('expo/fetch', () => ({ fetch: vi.fn() }));
vi.mock('@/lib/supabase-config', () => ({
  getConfiguredSupabaseUrl: () => 'https://project-ref.supabase.co',
}));

const logoUrl = 'https://cdn.ogabassey.com/media/logo.png';

const mockFetch = vi.mocked(
  fetch as (...args: Parameters<typeof fetch>) => Promise<Response>
);

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4z8AAAAMBAQCc479ZAAAAAElFTkSuQmCC';
const JPEG =
  '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABykX//Z';
const WEBP =
  'UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoBAAEAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA=';

function raster(base64: string) {
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

describe('resolveOrderReceiptLogo', () => {
  it.each([
    ['image/png', PNG],
    ['image/jpeg', JPEG],
    ['image/webp', WEBP],
  ])('embeds a bounded %s using its detected MIME type', async (type, base64) => {
    mockFetch.mockResolvedValue(
      new Response(raster(base64), {
        headers: { 'content-type': 'application/octet-stream' },
      })
    );
    expect(await resolveOrderReceiptLogo(logoUrl)).toEqual({
      logoUrl: `data:${type};base64,${base64}`,
    });
    expect(fetch).toHaveBeenCalledWith(
      logoUrl,
      expect.objectContaining({ redirect: 'error' })
    );
  });

  it.each([
    [
      'PNG',
      PNG,
      (view: DataView) => {
        view.setUint32(16, 3000);
        view.setUint32(20, 3000);
      },
    ],
    [
      'JPEG',
      JPEG,
      (view: DataView, image: Uint8Array) => {
        const start = image.findIndex(
          (byte, index) => byte === 0xff && image[index + 1] === 0xc0
        );
        view.setUint16(start + 5, 3000);
        view.setUint16(start + 7, 3000);
      },
    ],
    [
      'WebP',
      WEBP,
      (view: DataView) => {
        view.setUint16(26, 3000, true);
        view.setUint16(28, 3000, true);
      },
    ],
  ] as const)('rejects a %s that claims oversized decoded dimensions', async (_type, base64, patch) => {
    const image = raster(base64);
    patch(new DataView(image.buffer), image);
    mockFetch.mockResolvedValue(new Response(image));
    expect(await resolveOrderReceiptLogo(logoUrl)).toEqual({ logoUrl: null });
  });

  it('embeds valid raster bytes under an SVG filename', async () => {
    mockFetch.mockResolvedValue(new Response(raster(PNG)));
    await expect(
      resolveOrderReceiptLogo('https://cdn.ogabassey.com/media/logo.svg')
    ).resolves.toEqual({ logoUrl: `data:image/png;base64,${PNG}` });
  });

  it('rejects an animated PNG before embedding', async () => {
    const image = raster(PNG);
    const animationControl = Uint8Array.of(
      0,
      0,
      0,
      8,
      97,
      99,
      84,
      76,
      0,
      0,
      0,
      2,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    );
    const animated = new Uint8Array(image.length + animationControl.length);
    animated.set(image.subarray(0, 33));
    animated.set(animationControl, 33);
    animated.set(image.subarray(33), 33 + animationControl.length);
    mockFetch.mockResolvedValue(new Response(animated));
    expect(await resolveOrderReceiptLogo(logoUrl)).toEqual({ logoUrl: null });
  });

  it('rejects WebP animation before embedding', async () => {
    const image = raster(WEBP);
    const extendedHeader = Uint8Array.of(
      86,
      80,
      56,
      88,
      10,
      0,
      0,
      0,
      2,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    );
    const animated = new Uint8Array(image.length + extendedHeader.length);
    animated.set(image.subarray(0, 12));
    animated.set(extendedHeader, 12);
    animated.set(image.subarray(12), 12 + extendedHeader.length);
    new DataView(animated.buffer).setUint32(4, animated.length - 8, true);
    mockFetch.mockResolvedValue(new Response(animated));
    expect(await resolveOrderReceiptLogo(logoUrl)).toEqual({ logoUrl: null });
  });

  it('detects and sanitizes SVG markup under a raster filename', async () => {
    mockFetch.mockResolvedValue(
      new Response(
        '<?xml version="1.0"?><!-- Logo --><svg><script>alert(1)</script><rect /></svg>'
      )
    );
    const result = await resolveOrderReceiptLogo(logoUrl);
    expect(result.logoUrl).toBeNull();
    expect(result.svgXml).toContain('<rect');
    expect(result.svgXml).not.toContain('<script');
  });

  it('accepts JPEG restart intervals and entropy restart markers', async () => {
    const image = raster(JPEG);
    const expanded = new Uint8Array(image.length + 8);
    expanded.set(image.subarray(0, 2));
    expanded.set([0xff, 0xdd, 0x00, 0x04, 0x00, 0x01], 2);
    expanded.set(image.subarray(2, image.length - 2), 8);
    expanded.set([0xff, 0xd0, 0xff, 0xd9], expanded.length - 4);
    mockFetch.mockResolvedValue(new Response(expanded));
    const result = await resolveOrderReceiptLogo(logoUrl);
    expect(result.logoUrl).toBe(
      `data:image/jpeg;base64,${Buffer.from(expanded).toString('base64')}`
    );
  });

  it('encodes a raster spanning multiple blocks without interior padding', async () => {
    const image = raster(PNG);
    const payloadSize = 25_000;
    const chunk = new Uint8Array(payloadSize + 12);
    new DataView(chunk.buffer).setUint32(0, payloadSize);
    chunk.set(Uint8Array.of(116, 69, 88, 116), 4); // tEXt
    const expanded = new Uint8Array(image.length + chunk.length);
    expanded.set(image.subarray(0, 33));
    expanded.set(chunk, 33);
    expanded.set(image.subarray(33), 33 + chunk.length);
    mockFetch.mockResolvedValue(new Response(expanded));
    vi.stubGlobal('btoa', undefined);

    const result = await resolveOrderReceiptLogo(logoUrl);
    expect(result.logoUrl).toBe(
      `data:image/png;base64,${Buffer.from(expanded).toString('base64')}`
    );
  });

  it('discards oversized bodies without a content length', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(256 * 1024 + 1));
      },
      cancel,
    });
    mockFetch.mockResolvedValue(new Response(body));
    expect(await resolveOrderReceiptLogo(logoUrl)).toEqual({ logoUrl: null });
    expect(mockFetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('discards invalid image content', async () => {
    mockFetch.mockResolvedValue(new Response('<script>alert(1)</script>'));
    expect(await resolveOrderReceiptLogo(logoUrl)).toEqual({ logoUrl: null });
  });

  it('fetches configured Supabase public logos and rejects other projects', async () => {
    mockFetch.mockResolvedValue(new Response(raster(PNG)));
    const path = '/storage/v1/object/public/images/logo.png';
    await expect(
      resolveOrderReceiptLogo(`https://other.supabase.co${path}`)
    ).resolves.toEqual({ logoUrl: null });
    expect(fetch).not.toHaveBeenCalled();
    await expect(
      resolveOrderReceiptLogo(`https://project-ref.supabase.co${path}`)
    ).resolves.toEqual({ logoUrl: `data:image/png;base64,${PNG}` });
  });

  it('does not fetch logos outside trusted public media paths', async () => {
    expect(
      await resolveOrderReceiptLogo('https://example.com/logo.png')
    ).toEqual({ logoUrl: null });
    expect(fetch).not.toHaveBeenCalled();
  });
});

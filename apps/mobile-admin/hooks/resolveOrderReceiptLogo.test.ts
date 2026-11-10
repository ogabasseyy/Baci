import { fetch } from 'expo/fetch';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveOrderReceiptLogo } from './resolveOrderReceiptLogo';

vi.mock('expo/fetch', () => ({ fetch: vi.fn() }));

const logoUrl = 'https://cdn.ogabassey.com/media/logo.png';

const mockFetch = vi.mocked(
  fetch as (...args: Parameters<typeof fetch>) => Promise<Response>
);

afterEach(() => vi.resetAllMocks());

describe('resolveOrderReceiptLogo', () => {
  it('embeds supported raster bytes using their detected MIME type', async () => {
    mockFetch.mockResolvedValue(
      new Response(Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), {
        headers: { 'content-type': 'image/jpeg' },
      })
    );
    expect(await resolveOrderReceiptLogo(logoUrl)).toEqual({
      logoUrl: 'data:image/png;base64,iVBORw0KGgo=',
    });
    expect(fetch).toHaveBeenCalledWith(
      logoUrl,
      expect.objectContaining({ redirect: 'error' })
    );
  });

  it('discards oversized bodies without a content length', async () => {
    mockFetch.mockResolvedValue(new Response(new Uint8Array(256 * 1024 + 1)));
    expect(await resolveOrderReceiptLogo(logoUrl)).toEqual({ logoUrl: null });
    expect(mockFetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it('discards invalid image content', async () => {
    mockFetch.mockResolvedValue(new Response('<script>alert(1)</script>'));
    expect(await resolveOrderReceiptLogo(logoUrl)).toEqual({ logoUrl: null });
  });

  it('does not fetch logos outside trusted public media paths', async () => {
    expect(
      await resolveOrderReceiptLogo('https://example.com/logo.png')
    ).toEqual({ logoUrl: null });
    expect(fetch).not.toHaveBeenCalled();
  });
});

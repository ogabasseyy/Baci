import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockImageResponse, mockImageResponseArrayBuffer } = vi.hoisted(() => ({
  mockImageResponseArrayBuffer: vi.fn(),
  mockImageResponse: vi.fn(function ImageResponse(
    _element: unknown,
    options: unknown
  ) {
    const headers = new Headers(
      (options as { headers?: HeadersInit } | undefined)?.headers
    );
    headers.set('content-type', 'image/png');
    return {
      headers,
      status: 200,
      arrayBuffer: mockImageResponseArrayBuffer,
    };
  }),
}));

vi.mock('next/og', () => ({
  ImageResponse: mockImageResponse,
}));

import { createBlogOgImageResponse } from '@/app/(storefront)/[slug]/(blog)/blog/[postSlug]/opengraph-image-response';

const size = { width: 1200, height: 630 };

describe('createBlogOgImageResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockImageResponseArrayBuffer.mockResolvedValue(
      Uint8Array.from([137, 80, 78, 71]).buffer
    );
  });

  it('materializes dynamic ImageResponse output as strict no-store', async () => {
    const element = createElement('div', null, 'Primary');

    const response = await createBlogOgImageResponse(element, { size });

    expect(mockImageResponse).toHaveBeenCalledWith(
      element,
      expect.objectContaining(size)
    );
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
    await expect(response.arrayBuffer()).resolves.toHaveProperty(
      'byteLength',
      4
    );
  });

  it('uses the configured no-store fallback when primary rendering fails', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockImageResponseArrayBuffer
      .mockRejectedValueOnce(new Error('primary failed'))
      .mockResolvedValueOnce(Uint8Array.from([1, 2, 3]).buffer);
    const primaryElement = createElement('div', null, 'Primary');
    const fallbackElement = createElement('div', null, 'Fallback');

    const response = await createBlogOgImageResponse(primaryElement, {
      size,
      fallback: { element: fallbackElement },
    });

    expect(mockImageResponse).toHaveBeenCalledTimes(2);
    expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
    await expect(response.arrayBuffer()).resolves.toHaveProperty(
      'byteLength',
      3
    );
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to render merchant blog OG image',
      expect.objectContaining({ error: expect.any(Error) })
    );
  });

  it('keeps a fallback response no-store when primary rendering fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockImageResponseArrayBuffer
      .mockRejectedValueOnce(new Error('primary failed'))
      .mockResolvedValueOnce(Uint8Array.from([1, 2, 3]).buffer);
    const primaryElement = createElement('div', null, 'Primary');
    const fallbackElement = createElement('div', null, 'Fallback');

    const response = await createBlogOgImageResponse(primaryElement, {
      size,
      fallback: { element: fallbackElement },
    });

    expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
  });

  it('returns an emergency PNG when all rendering attempts fail', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockImageResponseArrayBuffer.mockRejectedValue(new Error('satori failed'));
    const primaryElement = createElement('div', null, 'Primary');
    const fallbackElement = createElement('div', null, 'Fallback');

    const response = await createBlogOgImageResponse(primaryElement, {
      size,
      fallback: { element: fallbackElement },
    });

    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
    await expect(response.arrayBuffer()).resolves.toHaveProperty(
      'byteLength',
      68
    );
  });
});

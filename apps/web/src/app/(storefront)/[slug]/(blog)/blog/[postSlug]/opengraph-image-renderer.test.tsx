import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetMerchantBlogOgImageData,
  mockImageResponse,
  mockImageResponseArrayBuffer,
} = vi.hoisted(() => ({
  mockGetMerchantBlogOgImageData: vi.fn(),
  mockImageResponseArrayBuffer: vi.fn(),
  mockImageResponse: vi.fn(function ImageResponse(
    element: unknown,
    options: unknown
  ) {
    const headers = new Headers(
      (options as { headers?: HeadersInit } | undefined)?.headers
    );
    headers.set('content-type', 'image/png');
    return {
      element,
      headers,
      options,
      status: 200,
      arrayBuffer: mockImageResponseArrayBuffer,
    };
  }),
}));

vi.mock('next/og', () => ({
  ImageResponse: mockImageResponse,
}));

vi.mock(
  '@/app/(storefront)/[slug]/(blog)/blog/[postSlug]/opengraph-image-data',
  () => ({
    getMerchantBlogOgImageData: (...args: unknown[]) =>
      mockGetMerchantBlogOgImageData(...args),
    getMerchantBlogOgMetadataData: vi.fn(),
  })
);

import type { MerchantBlogOgImageData } from '@/app/(storefront)/[slug]/(blog)/blog/[postSlug]/opengraph-image-data';
import Image, {
  size,
} from '@/app/(storefront)/[slug]/(blog)/blog/[postSlug]/opengraph-image-renderer';

function createData(
  overrides: Partial<MerchantBlogOgImageData> = {}
): MerchantBlogOgImageData {
  return {
    merchantBusinessName: 'Ogabassey',
    merchantBrandColors: {
      background: '#101820',
      primary: '#2f6fed',
      accent: '#f5a623',
    },
    post: {
      title: 'Best iPhone Deals',
      category: 'Smartphones',
      featured_image_url:
        'https://cdn.ogabassey.com/media/merchant-1/blog/raw.jpg',
      featured_image_alt: 'iPhone on desk',
      author_name: 'Baci Editorial',
      featured_image_width: 1200,
      featured_image_height: 675,
      featured_image_variants: {
        landscape_16x9:
          'https://cdn.ogabassey.com/media/merchant-1/blog/token/landscape_16x9.webp',
      },
    },
    featuredDataUri: 'data:image/jpeg;base64,ZmVhdHVyZWQ=',
    featuredImageStatus: 'loaded',
    logoDataUri: 'data:image/png;base64,bG9nbw==',
    ...overrides,
  };
}

function renderImage(slug = 'ogabassey.com', postSlug = 'best-deals') {
  return Image({
    params: Promise.resolve({ slug, postSlug }),
  });
}

function getLastImageResponseCall() {
  const call = mockImageResponse.mock.calls.at(-1);
  if (!call) throw new Error('ImageResponse was not called');
  return {
    element: call[0] as React.ReactElement<{
      children?: unknown;
      style?: Record<string, unknown>;
    }>,
    options: call[1] as {
      headers?: HeadersInit;
    },
  };
}

function collectText(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(collectText).join(' ');
  }
  if (typeof node === 'object' && 'props' in node) {
    return collectText(
      (node as { props: { children?: unknown } }).props.children
    );
  }
  return '';
}

function collectImageSources(node: unknown): string[] {
  if (node === null || node === undefined || typeof node !== 'object') {
    return [];
  }
  if (Array.isArray(node)) {
    return node.flatMap(collectImageSources);
  }
  if ('type' in node && 'props' in node) {
    const element = node as {
      type: unknown;
      props: { children?: unknown; src?: unknown };
    };
    const ownSource =
      element.type === 'img' && typeof element.props.src === 'string'
        ? [element.props.src]
        : [];
    return [...ownSource, ...collectImageSources(element.props.children)];
  }
  return [];
}

function cacheControlOf(headers?: HeadersInit) {
  return headers ? new Headers(headers).get('cache-control') : null;
}

describe('merchant blog post OG image route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockImageResponseArrayBuffer.mockResolvedValue(
      Uint8Array.from([137, 80, 78, 71]).buffer
    );
  });

  it('renders a no-store generic fallback when tenant data is unavailable', async () => {
    mockGetMerchantBlogOgImageData.mockResolvedValue(null);

    await renderImage();

    const { element, options } = getLastImageResponseCall();
    expect(collectText(element)).toContain('Post Not Found');
    expect(options).toMatchObject(size);
    expect(cacheControlOf(options.headers)).toBe('no-store, max-age=0');
  });

  it('renders a no-store generic fallback when data lookup throws', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockGetMerchantBlogOgImageData.mockRejectedValue(new Error('db failed'));

    await renderImage();

    const { element, options } = getLastImageResponseCall();
    expect(collectText(element)).toContain('Post Not Found');
    expect(cacheControlOf(options.headers)).toBe('no-store, max-age=0');
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to resolve merchant blog OG image',
      expect.objectContaining({ error: expect.any(Error) })
    );
  });

  it('renders a no-store merchant-branded fallback when the post is missing', async () => {
    mockGetMerchantBlogOgImageData.mockResolvedValue(
      createData({ post: null })
    );

    await renderImage();

    const { element, options } = getLastImageResponseCall();
    const text = collectText(element);
    expect(text).toContain('Ogabassey');
    expect(text).toContain('Post Not Found');
    expect(collectImageSources(element)).toContain(
      'data:image/png;base64,bG9nbw=='
    );
    expect(cacheControlOf(options.headers)).toBe('no-store, max-age=0');
  });

  it('uses no-store for transient image failures before rendering fallback art', async () => {
    mockGetMerchantBlogOgImageData.mockResolvedValue(
      createData({
        featuredDataUri: null,
        featuredImageStatus: 'timed_out',
      })
    );

    await renderImage();

    const { element, options } = getLastImageResponseCall();
    expect(collectText(element)).toContain('Best iPhone Deals');
    expect(cacheControlOf(options.headers)).toBe('no-store, max-age=0');
  });

  it('keeps permanent missing or disallowed image fallbacks no-store', async () => {
    mockGetMerchantBlogOgImageData.mockResolvedValue(
      createData({
        featuredDataUri: null,
        featuredImageStatus: 'source_disallowed',
      })
    );

    await renderImage();

    const { options } = getLastImageResponseCall();
    expect(cacheControlOf(options.headers)).toBe('no-store, max-age=0');
  });

  it('falls back to no-store merchant artwork when primary serialization fails', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockGetMerchantBlogOgImageData.mockResolvedValue(createData());
    mockImageResponseArrayBuffer
      .mockRejectedValueOnce(new Error('satori failed'))
      .mockResolvedValueOnce(Uint8Array.from([1, 2, 3]).buffer);

    const response = await renderImage();

    const { element, options } = getLastImageResponseCall();
    expect(response.status).toBe(200);
    expect(collectText(element)).toContain('Best iPhone Deals');
    expect(collectImageSources(element)).not.toContain(
      'data:image/jpeg;base64,ZmVhdHVyZWQ='
    );
    expect(cacheControlOf(options.headers)).toBe('no-store, max-age=0');
    expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to render merchant blog OG image',
      expect.objectContaining({ error: expect.any(Error) })
    );
  });

  it('returns an emergency PNG when all Satori rendering attempts fail', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockGetMerchantBlogOgImageData.mockResolvedValue(createData());
    mockImageResponseArrayBuffer.mockRejectedValue(new Error('satori failed'));

    const response = await renderImage();

    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
    await expect(response.arrayBuffer()).resolves.toHaveProperty(
      'byteLength',
      68
    );
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to render merchant blog OG fallback image',
      expect.objectContaining({ error: expect.any(Error) })
    );
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetMerchantBlogOgMetadataData, mockImageResponse } = vi.hoisted(
  () => ({
    mockGetMerchantBlogOgMetadataData: vi.fn(),
    mockImageResponse: vi.fn(),
  })
);

vi.mock('next/og', () => ({
  ImageResponse: mockImageResponse,
}));

vi.mock(
  '@/app/(storefront)/[slug]/(blog)/blog/[postSlug]/opengraph-image-data',
  () => ({
    getMerchantBlogOgImageData: vi.fn(),
    getMerchantBlogOgMetadataData: (...args: unknown[]) =>
      mockGetMerchantBlogOgMetadataData(...args),
  })
);

import {
  contentType,
  generateImageMetadata,
  size,
} from '@/app/(storefront)/[slug]/(blog)/blog/[postSlug]/opengraph-image-renderer';

describe('merchant blog post OG image metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports PNG ImageResponse route metadata', () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe('image/png');
  });

  it('generates lightweight alt metadata for the post image', async () => {
    mockGetMerchantBlogOgMetadataData.mockResolvedValue({
      merchantBusinessName: 'Ogabassey',
      post: { title: 'Best iPhone Deals' },
    });

    await expect(
      generateImageMetadata({
        params: Promise.resolve({
          slug: 'ogabassey.com',
          postSlug: 'best-deals',
        }),
      })
    ).resolves.toEqual([
      {
        id: 'merchant-blog-og',
        alt: 'Best iPhone Deals — Ogabassey',
        size,
        contentType,
      },
    ]);
    expect(mockGetMerchantBlogOgMetadataData).toHaveBeenCalledWith(
      'ogabassey.com',
      'best-deals'
    );
  });

  it('keeps full post titles in generated alt metadata', async () => {
    const longTitle = `${'A'.repeat(100)} tail`;
    mockGetMerchantBlogOgMetadataData.mockResolvedValue({
      merchantBusinessName: 'Ogabassey',
      post: { title: longTitle },
    });

    const [metadata] = await generateImageMetadata({
      params: Promise.resolve({
        slug: 'ogabassey.com',
        postSlug: 'long',
      }),
    });

    expect(metadata.alt).toBe(`${longTitle} — Ogabassey`);
  });
});

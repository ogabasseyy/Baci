import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetPlatformBlogOgMetadataData } = vi.hoisted(() => ({
  mockGetPlatformBlogOgMetadataData: vi.fn(),
}));

vi.mock('next/og', () => ({
  ImageResponse: vi.fn(),
}));

vi.mock('@/app/(platform)/blog/[slug]/opengraph-image-data', () => ({
  getPlatformBlogOgImageData: vi.fn(),
  getPlatformBlogOgMetadataData: (...args: unknown[]) =>
    mockGetPlatformBlogOgMetadataData(...args),
}));

import {
  contentType,
  generateImageMetadata,
  size,
} from '@/app/(platform)/blog/[slug]/opengraph-image';

describe('platform blog OG image metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports PNG ImageResponse route metadata', () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe('image/png');
  });

  it('generates lightweight alt metadata for the post image', async () => {
    mockGetPlatformBlogOgMetadataData.mockResolvedValue({
      businessName: 'Baci',
      post: { title: 'Launch Faster' },
    });

    await expect(
      generateImageMetadata({
        params: Promise.resolve({
          slug: 'launch-faster',
        }),
      })
    ).resolves.toEqual([
      {
        id: 'platform-blog-og',
        alt: 'Launch Faster — Baci',
        size,
        contentType,
      },
    ]);
    expect(mockGetPlatformBlogOgMetadataData).toHaveBeenCalledWith(
      'launch-faster'
    );
  });
});

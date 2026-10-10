import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlogFeaturedImageError } from '@/lib/blog-featured-image-variants';
import {
  extractManagedBlogStoragePath,
  generateFeaturedImageVariants,
  isManagedBlogStoragePath,
} from '@/lib/blog-featured-image-variants';

function createPng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 24, g: 64, b: 120 },
    },
  })
    .png()
    .toBuffer();
}

function createOrientationTaggedJpeg(
  width: number,
  height: number,
  orientation: number
): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 24, g: 64, b: 120 },
    },
  })
    .jpeg()
    .withMetadata({ orientation })
    .toBuffer();
}

describe('generateFeaturedImageVariants', () => {
  it('rejects GIF uploads for featured images', async () => {
    const source = await createPng(1200, 675);

    await expect(
      generateFeaturedImageVariants(source, {
        mimeType: 'image/gif',
      })
    ).rejects.toMatchObject({
      code: 'FEATURED_IMAGE_GIF_NOT_ALLOWED',
    } satisfies Partial<BlogFeaturedImageError>);
  });

  it('rejects source images that cannot cover 1200x675', async () => {
    const source = await createPng(1200, 630);

    await expect(
      generateFeaturedImageVariants(source, {
        mimeType: 'image/png',
      })
    ).rejects.toMatchObject({
      code: 'FEATURED_IMAGE_DIMENSIONS_TOO_SMALL',
    } satisfies Partial<BlogFeaturedImageError>);
  });

  it('generates landscape, 4:3, and 1:1 variants without upscaling', async () => {
    const source = await createPng(1200, 675);

    const result = await generateFeaturedImageVariants(source, {
      mimeType: 'image/png',
    });

    expect(result.source.width).toBe(1200);
    expect(result.source.height).toBe(675);

    expect(result.variants.landscape_16x9).toMatchObject({
      width: 1200,
      height: 675,
      contentType: 'image/webp',
    });
    expect(result.variants.standard_4x3).toMatchObject({
      width: 900,
      height: 675,
      contentType: 'image/webp',
    });
    expect(result.variants.square_1x1).toMatchObject({
      width: 675,
      height: 675,
      contentType: 'image/webp',
    });

    const standard43 = result.variants.standard_4x3;
    const square11 = result.variants.square_1x1;

    expect(result.variants.landscape_16x9.buffer.byteLength).toBeGreaterThan(0);
    expect(standard43).toBeDefined();
    expect(square11).toBeDefined();
    expect(standard43?.buffer.byteLength).toBeGreaterThan(0);
    expect(square11?.buffer.byteLength).toBeGreaterThan(0);
  });

  it('validates minimum dimensions after applying EXIF orientation', async () => {
    const source = await createOrientationTaggedJpeg(675, 1200, 6);

    const result = await generateFeaturedImageVariants(source, {
      mimeType: 'image/jpeg',
    });

    expect(result.source.width).toBe(1200);
    expect(result.source.height).toBe(675);
    expect(result.variants.landscape_16x9).toMatchObject({
      width: 1200,
      height: 675,
    });
  });

  it('omits optional variants when they do not meet minimum optional pixel area', async () => {
    const source = await createPng(1200, 675);

    const result = await generateFeaturedImageVariants(source, {
      mimeType: 'image/png',
      minimumOptionalPixelArea: 700_000,
    });

    expect(result.variants.landscape_16x9).toBeTruthy();
    expect(result.variants.standard_4x3).toBeUndefined();
    expect(result.variants.square_1x1).toBeUndefined();
  });

  it('rejects sources above decoded-pixel safety ceiling', async () => {
    const source = await createPng(1200, 675);

    await expect(
      generateFeaturedImageVariants(source, {
        mimeType: 'image/png',
        maxDecodedPixelArea: 200_000,
      })
    ).rejects.toMatchObject({
      code: 'FEATURED_IMAGE_PIXELS_TOO_LARGE',
    } satisfies Partial<BlogFeaturedImageError>);
  });

  it('rejects unreadable image buffers', async () => {
    const invalidBuffer = Buffer.from('not-an-image');

    await expect(
      generateFeaturedImageVariants(invalidBuffer, {
        mimeType: 'image/png',
      })
    ).rejects.toMatchObject({
      code: 'FEATURED_IMAGE_METADATA_UNREADABLE',
    } satisfies Partial<BlogFeaturedImageError>);
  });
});

describe('managed blog storage path helpers', () => {
  // Managed-path extraction trusts only the configured CDN and
  // Supabase origins, so the storage-URL cases run under a stubbed
  // Supabase origin.
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
  });
  afterEach(vi.unstubAllEnvs);
  const merchantId = '11111111-1111-4111-8111-111111111111';

  it('accepts legacy and variant paths for the same merchant', () => {
    expect(
      isManagedBlogStoragePath(
        `${merchantId}/blog/abcdef123456.png`,
        merchantId
      )
    ).toBe(true);
    expect(
      isManagedBlogStoragePath(
        `${merchantId}/blog/abcdef123456/landscape_16x9.webp`,
        merchantId
      )
    ).toBe(true);
    expect(
      isManagedBlogStoragePath(
        `22222222-2222-4222-8222-222222222222/blog/abcdef123456.png`,
        merchantId
      )
    ).toBe(false);
  });

  it('extracts managed blog paths from media public URLs', () => {
    const publicUrl =
      'https://project.supabase.co/storage/v1/object/public/media/11111111-1111-4111-8111-111111111111/blog/abcdef123456/landscape_16x9.webp';

    expect(extractManagedBlogStoragePath(publicUrl, merchantId)).toBe(
      `${merchantId}/blog/abcdef123456/landscape_16x9.webp`
    );
    expect(
      extractManagedBlogStoragePath(
        publicUrl,
        '22222222-2222-4222-8222-222222222222'
      )
    ).toBeNull();
  });
});

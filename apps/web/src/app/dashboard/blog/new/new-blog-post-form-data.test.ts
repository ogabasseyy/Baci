import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyPostFormData,
  getFeaturedImagePreviewUrl,
  normalizeFeaturedImageVariantMap,
  reconstructUploadedFeaturedImage,
  withFeaturedImageDefaults,
} from './new-blog-post-form-data';

describe('new blog post form data', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN', 'https://cdn.example.com');
  });
  afterEach(vi.unstubAllEnvs);
  it('creates a blank draft while preserving the supplied author name', () => {
    expect(createEmptyPostFormData('Ada')).toMatchObject({
      author_name: 'Ada',
      featured_image_height: null,
      featured_image_variants: {},
      featured_image_width: null,
      title: '',
    });
  });

  it('keeps only recognized non-empty featured image variants', () => {
    expect(
      normalizeFeaturedImageVariantMap({
        landscape_16x9: 'https://cdn.example.com/landscape.webp',
        square_1x1: '   ',
        unexpected: 'https://cdn.example.com/unexpected.webp',
      })
    ).toEqual({
      landscape_16x9: 'https://cdn.example.com/landscape.webp',
    });
  });

  it('prefers the landscape variant for the featured image preview', () => {
    const data = createEmptyPostFormData('Ada');
    data.featured_image_url = 'https://cdn.example.com/original.png';
    data.featured_image_variants = {
      landscape_16x9: 'https://cdn.example.com/landscape.webp',
    };

    expect(getFeaturedImagePreviewUrl(data)).toBe(
      'https://cdn.example.com/landscape.webp'
    );
  });

  it('normalizes missing dimensions and malformed variants for recovered drafts', () => {
    const data = createEmptyPostFormData('Ada');
    const recovered = {
      ...data,
      featured_image_height: undefined,
      featured_image_variants: null,
      featured_image_width: undefined,
    } as never;

    expect(withFeaturedImageDefaults(recovered)).toMatchObject({
      featured_image_height: null,
      featured_image_variants: {},
      featured_image_width: null,
    });
  });

  it('reconstructs cleanup paths only for media owned by the active merchant', () => {
    const data = createEmptyPostFormData('Ada');
    data.featured_image_url =
      'https://cdn.example.com/media/merchant-1/blog/original.png';
    data.featured_image_variants = {
      landscape_16x9:
        'https://cdn.example.com/media/merchant-1/blog/upload-1/landscape_16x9.webp',
      square_1x1:
        'https://cdn.example.com/media/merchant-2/blog/upload-1/square_1x1.webp',
    };

    expect(reconstructUploadedFeaturedImage(data, 'merchant-1')).toEqual({
      path: 'merchant-1/blog/original.png',
      variantPaths: {
        landscape_16x9: 'merchant-1/blog/upload-1/landscape_16x9.webp',
      },
    });
    expect(reconstructUploadedFeaturedImage(data, 'merchant-2')).toBeNull();
  });
});

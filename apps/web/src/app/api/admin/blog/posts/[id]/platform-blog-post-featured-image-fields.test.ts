import { describe, expect, it } from 'vitest';
import { hasFeaturedImageFields } from './platform-blog-post-featured-image-fields';

describe('hasFeaturedImageFields', () => {
  it.each([
    [
      'featured_image_url',
      { featured_image_url: 'https://cdn.example.com/a.webp' },
    ],
    ['featured_image_width', { featured_image_width: 1200 }],
    ['featured_image_height', { featured_image_height: 675 }],
    ['featured_image_variants', { featured_image_variants: {} }],
  ])('returns true when %s is present', (_field, payload) => {
    expect(hasFeaturedImageFields(payload)).toBe(true);
  });

  it('returns false when no featured image field is present', () => {
    expect(hasFeaturedImageFields({ title: 'Updated Title' })).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLATFORM_BLOG_FORM_STATE,
  type PlatformAdminBlogPostDetail,
} from './blog-types';
import { shouldIncludeFeaturedImageFields } from './should-include-featured-image-fields';

const form = {
  ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
  featured_image_url: 'https://cdn.example.com/cover.webp',
  featured_image_width: 1200,
  featured_image_height: 675,
  featured_image_variants: {
    landscape_16x9: 'https://cdn.example.com/landscape.webp',
  },
};
const post: PlatformAdminBlogPostDetail = {
  ...form,
  id: 'post-1',
  published_at: null,
  tags: [],
};

describe('shouldIncludeFeaturedImageFields', () => {
  it.each([
    null,
    undefined,
  ])('includes image fields without an existing post', (existing) => {
    expect(shouldIncludeFeaturedImageFields(form, existing)).toBe(true);
  });
  it('omits unchanged image fields even when editorial fields change', () => {
    expect(
      shouldIncludeFeaturedImageFields(
        {
          ...form,
          title: 'New title',
          featured_image_url: ` ${form.featured_image_url} `,
        },
        post
      )
    ).toBe(false);
  });
  it.each([
    { featured_image_url: '' },
    { featured_image_width: null },
    { featured_image_height: 900 },
    { featured_image_variants: {} },
    {
      featured_image_variants: {
        landscape_16x9: 'https://cdn.example.com/new.webp',
      },
    },
  ])('includes a changed or cleared image field: %j', (change) => {
    expect(shouldIncludeFeaturedImageFields({ ...form, ...change }, post)).toBe(
      true
    );
  });
  it('normalizes null existing metadata to the empty form values', () => {
    expect(
      shouldIncludeFeaturedImageFields(DEFAULT_PLATFORM_BLOG_FORM_STATE, {
        ...post,
        featured_image_url: null,
        featured_image_width: null,
        featured_image_height: null,
        featured_image_variants: null,
      })
    ).toBe(false);
  });
});

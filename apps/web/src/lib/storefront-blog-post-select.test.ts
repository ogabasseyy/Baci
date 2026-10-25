import { describe, expect, it } from 'vitest';
import { STOREFRONT_BLOG_POST_SELECT } from '@/lib/storefront-blog-post-select';

describe('STOREFRONT_BLOG_POST_SELECT', () => {
  it('matches the current public blog_posts schema for storefront detail pages', () => {
    const fields = STOREFRONT_BLOG_POST_SELECT.split(',').map((field) =>
      field.trim()
    );

    expect(fields).toContain('author_image_url');
    expect(fields).toContain('seo_title');
    expect(fields).toContain('seo_description');
    expect(fields).toContain('featured_image_width');
    expect(fields).toContain('featured_image_height');
    expect(fields).toContain('featured_image_variants');
    expect(fields).toContain('classification_revision');
    expect(fields).not.toContain('author_avatar');
    expect(fields).not.toContain('meta_title');
    expect(fields).not.toContain('meta_description');
  });
});

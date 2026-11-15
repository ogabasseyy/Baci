import { describe, expect, it, vi } from 'vitest';
import { blogPostSchema, sanitizeBlogPostData } from './blog';

// Mock sanitizeHtml to avoid pulling in the full sanitizer
vi.mock('@/lib/sanitize', () => ({
  sanitizeHtml: (html: string) => html,
}));

describe('blogPostSchema', () => {
  it('accepts embedded product UUIDs', () => {
    const productId = 'd5bc84b7-35c2-4e09-a5e7-6ebdd0fd1145';

    expect(
      blogPostSchema.safeParse({
        title: 'Post with products',
        embedded_products: [productId],
      }).success
    ).toBe(true);
  });

  it('rejects duplicate embedded product UUIDs', () => {
    const productId = 'd5bc84b7-35c2-4e09-a5e7-6ebdd0fd1145';

    expect(
      blogPostSchema.safeParse({
        title: 'Post with duplicate products',
        embedded_products: [productId, productId],
      }).success
    ).toBe(false);
  });

  describe('title', () => {
    it('requires title to be non-empty', () => {
      const result = blogPostSchema.safeParse({ title: '' });
      expect(result.success).toBe(false);
    });

    it('accepts a valid title', () => {
      const result = blogPostSchema.safeParse({ title: 'My Post' });
      expect(result.success).toBe(true);
    });
  });

  describe('slug', () => {
    it('accepts a valid slug', () => {
      const result = blogPostSchema.safeParse({
        title: 'Test',
        slug: 'my-post-123',
      });
      expect(result.success).toBe(true);
    });

    it('rejects slug with uppercase letters', () => {
      const result = blogPostSchema.safeParse({
        title: 'Test',
        slug: 'My-Post',
      });
      expect(result.success).toBe(false);
    });

    it('rejects slug with spaces', () => {
      const result = blogPostSchema.safeParse({
        title: 'Test',
        slug: 'my post',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('status', () => {
    it('accepts draft status', () => {
      const result = blogPostSchema.safeParse({
        title: 'Test',
        status: 'draft',
      });
      expect(result.success).toBe(true);
    });

    it('accepts published status', () => {
      const result = blogPostSchema.safeParse({
        title: 'Test',
        status: 'published',
      });
      expect(result.success).toBe(true);
    });

    it('accepts archived status', () => {
      const result = blogPostSchema.safeParse({
        title: 'Test',
        status: 'archived',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid status', () => {
      const result = blogPostSchema.safeParse({
        title: 'Test',
        status: 'deleted',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('published_at', () => {
    it('accepts null', () => {
      const result = blogPostSchema.safeParse({
        title: 'Test',
        published_at: null,
      });
      expect(result.success).toBe(true);
    });

    it('accepts ISO datetime with Z suffix', () => {
      const result = blogPostSchema.safeParse({
        title: 'Test',
        published_at: '2026-03-24T10:00:00Z',
      });
      expect(result.success).toBe(true);
    });

    it('accepts ISO datetime with offset', () => {
      const result = blogPostSchema.safeParse({
        title: 'Test',
        published_at: '2026-03-24T10:00:00+00:00',
      });
      expect(result.success).toBe(true);
    });

    it('accepts datetime with microseconds and offset', () => {
      const result = blogPostSchema.safeParse({
        title: 'Test',
        published_at: '2026-03-24T10:00:00.123456+00:00',
      });
      expect(result.success).toBe(true);
    });

    it('rejects ISO datetimes without a timezone', () => {
      const result = blogPostSchema.safeParse({
        title: 'Test',
        published_at: '2026-03-24T10:00:00',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid date strings', () => {
      const result = blogPostSchema.safeParse({
        title: 'Test',
        published_at: 'not-a-date',
      });
      expect(result.success).toBe(false);
    });

    it('accepts undefined (omitted)', () => {
      const result = blogPostSchema.safeParse({ title: 'Test' });
      expect(result.success).toBe(true);
      expect(result.data?.published_at).toBeUndefined();
    });
  });

  describe('featured image metadata', () => {
    it('accepts known featured image variants and dimensions', () => {
      const result = blogPostSchema.safeParse({
        title: 'Test',
        featured_image_url:
          'https://cdn.example.com/storage/v1/object/public/media/merchant-1/blog/cover.png',
        featured_image_width: 1200,
        featured_image_height: 675,
        featured_image_variants: {
          landscape_16x9:
            'https://cdn.example.com/storage/v1/object/public/media/merchant-1/blog/upload-1/landscape_16x9.webp',
        },
      });

      expect(result.success).toBe(true);
    });

    it('rejects unknown featured image variant keys', () => {
      const result = blogPostSchema.safeParse({
        title: 'Test',
        featured_image_variants: {
          unknown_ratio: 'https://cdn.example.com/variant.webp',
        },
      });

      expect(result.success).toBe(false);
    });
  });
});

describe('sanitizeBlogPostData', () => {
  it('converts empty nullable fields to null', () => {
    const result = sanitizeBlogPostData({
      excerpt: '',
      category: '  ',
      seo_title: '',
    });
    expect(result.excerpt).toBeNull();
    expect(result.category).toBeNull();
    expect(result.seo_title).toBeNull();
  });

  it('converts empty non-nullable fields to undefined', () => {
    const result = sanitizeBlogPostData({
      title: '',
      slug: '  ',
    });
    expect(result.title).toBeUndefined();
    expect(result.slug).toBeUndefined();
  });

  it('trims string values', () => {
    const result = sanitizeBlogPostData({
      title: '  My Title  ',
      slug: ' my-slug ',
    });
    expect(result.title).toBe('My Title');
    expect(result.slug).toBe('my-slug');
  });

  it('splits comma-separated tags into arrays', () => {
    const result = sanitizeBlogPostData({
      tags: 'tag1, tag2, tag3',
    });
    expect(result.tags).toEqual(['tag1', 'tag2', 'tag3']);
  });

  it('splits comma-separated keywords into arrays', () => {
    const result = sanitizeBlogPostData({
      keywords: 'seo, marketing',
    });
    expect(result.keywords).toEqual(['seo', 'marketing']);
  });

  it('filters empty items from split tags', () => {
    const result = sanitizeBlogPostData({
      tags: 'tag1,, ,tag2',
    });
    expect(result.tags).toEqual(['tag1', 'tag2']);
  });

  it('cleans existing arrays by trimming and removing empty items', () => {
    const result = sanitizeBlogPostData({
      tags: ['  tag1 ', '', null, 'tag2'],
    });
    expect(result.tags).toEqual(['tag1', 'tag2']);
  });

  it('passes through non-string types unchanged', () => {
    const result = sanitizeBlogPostData({
      count: 42,
      active: true,
      published_at: null,
    });
    expect(result.count).toBe(42);
    expect(result.active).toBe(true);
    expect(result.published_at).toBeNull();
  });

  it('preserves image dimensions and variant maps', () => {
    const variants = {
      landscape_16x9:
        'https://cdn.example.com/storage/v1/object/public/media/merchant-1/blog/upload-1/landscape_16x9.webp',
    };

    const result = sanitizeBlogPostData({
      featured_image_width: 1200,
      featured_image_height: 675,
      featured_image_variants: variants,
    });

    expect(result.featured_image_width).toBe(1200);
    expect(result.featured_image_height).toBe(675);
    expect(result.featured_image_variants).toEqual(variants);
  });

  it('clears image metadata when the featured image URL is emptied', () => {
    const result = sanitizeBlogPostData({
      featured_image_url: ' ',
      featured_image_width: 1200,
      featured_image_height: 675,
      featured_image_variants: {
        landscape_16x9:
          'https://cdn.example.com/storage/v1/object/public/media/merchant-1/blog/upload-1/landscape_16x9.webp',
      },
    });

    expect(result.featured_image_url).toBeNull();
    expect(result.featured_image_width).toBeNull();
    expect(result.featured_image_height).toBeNull();
    expect(result.featured_image_variants).toEqual({});
  });
});

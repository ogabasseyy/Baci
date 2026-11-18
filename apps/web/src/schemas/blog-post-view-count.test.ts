import { describe, expect, it } from 'vitest';
import {
  incrementViewCountPostIdSchema,
  trackBlogPostViewSchema,
} from './blog-post-view-count';

describe('incrementViewCountPostIdSchema', () => {
  it('accepts and trims non-empty post ids', () => {
    const result = incrementViewCountPostIdSchema.safeParse(' post-123 ');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('post-123');
    }
  });

  it('rejects blank and non-string post ids', () => {
    expect(incrementViewCountPostIdSchema.safeParse('   ').success).toBe(false);
    expect(incrementViewCountPostIdSchema.safeParse(null).success).toBe(false);
  });
});

describe('trackBlogPostViewSchema', () => {
  it('accepts and trims valid slugs up to 200 characters', () => {
    const trimmed = trackBlogPostViewSchema.safeParse({
      slug: ' My_Blog-Slug_1 ',
    });
    expect(trimmed.success).toBe(true);
    if (trimmed.success) {
      expect(trimmed.data.slug).toBe('My_Blog-Slug_1');
    }

    const maxBoundary = trackBlogPostViewSchema.safeParse({
      slug: 'a'.repeat(200),
    });
    expect(maxBoundary.success).toBe(true);
  });

  it('rejects missing, non-string, and blank slugs', () => {
    expect(trackBlogPostViewSchema.safeParse({}).success).toBe(false);
    expect(trackBlogPostViewSchema.safeParse({ slug: 123 }).success).toBe(
      false
    );
    expect(trackBlogPostViewSchema.safeParse({ slug: null }).success).toBe(
      false
    );
    expect(trackBlogPostViewSchema.safeParse({ slug: '' }).success).toBe(false);
    expect(trackBlogPostViewSchema.safeParse({ slug: '   ' }).success).toBe(
      false
    );
  });

  it('rejects invalid characters and slugs longer than 200 characters', () => {
    const invalidSlash = trackBlogPostViewSchema.safeParse({
      slug: 'bad/slug',
    });
    expect(invalidSlash.success).toBe(false);
    expect(
      trackBlogPostViewSchema.safeParse({ slug: 'bad slug' }).success
    ).toBe(false);
    expect(
      trackBlogPostViewSchema.safeParse({ slug: 'bad.slug' }).success
    ).toBe(false);
    expect(
      trackBlogPostViewSchema.safeParse({ slug: 'a'.repeat(201) }).success
    ).toBe(false);
  });
});

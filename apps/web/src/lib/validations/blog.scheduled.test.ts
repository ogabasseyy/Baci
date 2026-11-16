import { describe, expect, it, vi } from 'vitest';
import { blogPostSchema, createPostSchema, updateBlogPostSchema } from './blog';

vi.mock('@/lib/sanitize', () => ({
  sanitizeHtml: (html: string) => html,
}));

describe('createPostSchema scheduled validation', () => {
  it('requires published_at when status is scheduled', () => {
    expect(
      createPostSchema.safeParse({
        author_name: 'Editor',
        content: 'Scheduled post body',
        slug: 'scheduled-post',
        status: 'scheduled',
        title: 'Scheduled Post',
      }).success
    ).toBe(false);
    expect(
      createPostSchema.safeParse({
        author_name: 'Editor',
        content: 'Scheduled post body',
        published_at: '2026-11-16T10:00:00.000Z',
        slug: 'scheduled-post',
        status: 'scheduled',
        title: 'Scheduled Post',
      }).success
    ).toBe(true);
  });

  it('keeps blogPostSchema compatible with partial() and pick() while updateBlogPostSchema enforces scheduled published_at', () => {
    expect(() => blogPostSchema.partial()).not.toThrow();
    expect(() => blogPostSchema.pick({ title: true })).not.toThrow();
    const result = updateBlogPostSchema.safeParse({
      published_at: null,
      status: 'scheduled',
      title: 'Scheduled Post',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.path.includes('published_at'))
      ).toBe(true);
    }
  });
});

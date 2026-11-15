import { describe, expect, it, vi } from 'vitest';
import { createPostSchema } from './blog';

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
});

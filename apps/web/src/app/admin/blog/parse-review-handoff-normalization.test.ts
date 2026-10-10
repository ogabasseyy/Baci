import { expect, it, vi } from 'vitest';
import { parseReviewHandoff } from './parse-review-handoff';

vi.mock('@/lib/validations/blog', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/validations/blog')>();
  return {
    ...actual,
    blogPostSchema: {
      ...actual.blogPostSchema,
      shape: actual.blogPostSchema.shape,
      pick: (mask: Parameters<typeof actual.blogPostSchema.pick>[0]) =>
        actual.blogPostSchema.pick(mask).transform((data) => ({
          ...data,
          title: 'Schema-normalized title',
        })),
    },
  };
});

it('returns metadata produced by schema validation, including normalization', () => {
  const result = parseReviewHandoff({
    schema_version: 'baci-blog-review-handoff/v1',
    title: 'Original title',
    content_html: '<p>Article body.</p>',
    featured_image: { url: 'https://cdn.example.com/cover.webp' },
  });
  expect(result.title).toBe('Schema-normalized title');
});

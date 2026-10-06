import { describe, expect, it } from 'vitest';
import { parseReviewHandoff } from './parse-review-handoff';

const handoff = {
  schema_version: 'baci-blog-review-handoff/v1',
  title: 'Galaxy A buyer guide',
  content_html: '<p>Choose a Galaxy A phone.</p>',
  featured_image: { url: 'https://cdn.example.com/galaxy-a.webp' },
};

describe('handoff text safety', () => {
  it.each([
    'title',
    'author_name',
    'category',
  ] as const)('rejects null bytes in %s', (field) => {
    const nul = String.fromCharCode(0);
    expect(() =>
      parseReviewHandoff({ ...handoff, [field]: `Galaxy${nul}A` })
    ).toThrow('null bytes');
  });

  it('rejects null bytes in inline media URLs', () => {
    const nul = String.fromCharCode(0);
    expect(() =>
      parseReviewHandoff({
        ...handoff,
        content_html: `<p>Body</p><img src="https://cdn.example.com/a${nul}.webp" alt="A">`,
      })
    ).toThrow('null bytes');
  });
});

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

  it.each([
    'title',
    'author_name',
    'category',
  ] as const)('rejects unpaired surrogates in %s', (field) => {
    const high = String.fromCharCode(0xd800);
    expect(() =>
      parseReviewHandoff({ ...handoff, [field]: `Galaxy${high}A` })
    ).toThrow('unpaired surrogates');
  });

  it('rejects a lone low surrogate in the title', () => {
    const low = String.fromCharCode(0xdc00);
    expect(() =>
      parseReviewHandoff({ ...handoff, title: `Galaxy${low}A` })
    ).toThrow('unpaired surrogates');
  });

  it('accepts paired surrogates as ordinary characters', () => {
    const draft = parseReviewHandoff({
      ...handoff,
      title: 'Galaxy 😀 guide',
    });
    expect(draft.title).toBe('Galaxy 😀 guide');
  });

  it.each([
    ['U+200B', String.fromCharCode(0x200b)],
    ['U+034F', String.fromCharCode(0x034f)],
    ['U+FEFF', String.fromCharCode(0xfeff)],
  ])('rejects invisible-only titles (%s)', (_label, invisible) => {
    expect(() => parseReviewHandoff({ ...handoff, title: invisible })).toThrow(
      'title and article content are required'
    );
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

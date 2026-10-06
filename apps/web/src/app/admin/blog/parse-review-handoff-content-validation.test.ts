import { describe, expect, it } from 'vitest';
import { parseReviewHandoff } from './parse-review-handoff';

const handoff = {
  schema_version: 'baci-blog-review-handoff/v1',
  title: 'Galaxy A buyer guide',
  content_html: '<p>Choose a Galaxy A phone.</p>',
  featured_image: { url: 'https://cdn.example.com/galaxy-a.webp' },
};

describe('handoff content validation', () => {
  it('rejects placeholders hidden behind HTML entities', () => {
    expect(() =>
      parseReviewHandoff({
        ...handoff,
        content_html: '<p>&#123;&#123;INLINE_IMAGE_1&#125;&#125;</p>',
      })
    ).toThrow('unresolved inline image placeholders');
  });

  it.each([
    '<p><br></p>',
    '<p>&nbsp;</p>',
    '<div>   </div>',
  ])('rejects content without readable text or images: %s', (content_html) => {
    expect(() => parseReviewHandoff({ ...handoff, content_html })).toThrow(
      'no readable text or images'
    );
  });

  it('accepts an image-only article with secure media', () => {
    expect(
      parseReviewHandoff({
        ...handoff,
        content_html:
          '<p><img src="https://cdn.example.com/phone.webp" alt="Phone"></p>',
      }).content
    ).toContain('https://cdn.example.com/phone.webp');
  });

  it.each([
    '<img src="assets/photo.png" alt="Photo">',
    '<img src="http://example.com/photo.png" alt="Photo">',
    '<img src="//example.com/photo.png" alt="Photo">',
    '<img alt="Photo">',
    '<p>Body</p><img src="https://cdn.example.com/ok.webp" srcset="http://example.com/hd.png 2x">',
    '<picture><source srcset="assets/hd.webp 2x" type="image/webp"></picture>',
  ])('rejects inline media the published page cannot render: %s', (snippet) => {
    expect(() =>
      parseReviewHandoff({ ...handoff, content_html: `<p>Body</p>${snippet}` })
    ).toThrow('must use HTTPS URLs');
  });

  it('accepts secure and embedded inline media', () => {
    const { content } = parseReviewHandoff({
      ...handoff,
      content_html:
        '<p>Body</p><img src="https://cdn.example.com/a.webp" alt="A"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="B">',
    });
    expect(content).toContain('https://cdn.example.com/a.webp');
  });

  it('ignores src-like text inside other attributes', () => {
    expect(
      parseReviewHandoff({
        ...handoff,
        content_html:
          '<p>Body</p><img alt="a src = b > c" src="https://cdn.example.com/a.webp">',
      }).content
    ).toContain('https://cdn.example.com/a.webp');
  });
});

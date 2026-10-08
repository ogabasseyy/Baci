import { describe, expect, it } from 'vitest';
import { validateImportedContent } from './review-handoff-content';

describe('validateImportedContent', () => {
  it('rejects placeholders hidden behind HTML entities', () => {
    expect(() =>
      validateImportedContent('<p>&#123;&#123;INLINE_IMAGE_1&#125;&#125;</p>')
    ).toThrow('unresolved inline image placeholders');
  });

  it.each([
    '<p><br></p>',
    '<p>&nbsp;</p>',
    '<div>   </div>',
  ])('rejects content without readable text or images: %s', (content_html) => {
    expect(() => validateImportedContent(content_html)).toThrow(
      'no readable text or images'
    );
  });

  it.each([
    '<picture><source srcset="https://cdn.example.com/image.webp"></picture>',
    '<source srcset="https://cdn.example.com/image.webp">',
  ])('rejects media-only content without a renderable image: %s', (content_html) => {
    expect(() => validateImportedContent(content_html)).toThrow(
      'no readable text or images'
    );
  });

  it('accepts picture content with an accompanying image', () => {
    expect(
      validateImportedContent(
        '<picture><source srcset="https://cdn.example.com/image.webp" type="image/webp"><img src="https://cdn.example.com/image.png" alt="Image"></picture>'
      )
    ).toContain('<img');
  });

  it('accepts an image-only article with secure media', () => {
    expect(
      validateImportedContent(
        '<p><img src="https://cdn.example.com/phone.webp" alt="Phone"></p>'
      )
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
    expect(() => validateImportedContent(`<p>Body</p>${snippet}`)).toThrow(
      'must use HTTPS URLs'
    );
  });

  it('accepts secure inline media', () => {
    const content = validateImportedContent(
      '<p>Body</p><img src="https://cdn.example.com/a.webp" alt="A">'
    );
    expect(content).toContain('https://cdn.example.com/a.webp');
  });

  it('rejects embedded image media even with a valid payload', () => {
    expect(() =>
      validateImportedContent(
        '<p>Body</p><img src="https://cdn.example.com/a.webp" alt="A"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="B">'
      )
    ).toThrow('must use HTTPS URLs');
  });

  it.each([
    '<img src="data:text/html,<p>x</p>" alt="X">',
    '<img src="data:text/plain,hello" alt="X">',
    '<img src="data:" alt="X">',
    '<img src="data:image/png," alt="X">',
  ])('rejects embedded non-image media: %s', (snippet) => {
    expect(() => validateImportedContent(`<p>Body</p>${snippet}`)).toThrow(
      'must use HTTPS URLs'
    );
  });

  it.each([
    '<p>&#8203;</p>',
    '<p>&shy;</p>',
    '<p>\u200b</p>',
  ])('rejects content with only invisible characters: %s', (content_html) => {
    expect(() => validateImportedContent(content_html)).toThrow(
      'no readable text or images'
    );
  });

  it.each([
    '<p>&#8288;</p>',
    '<p>&#8206;</p>',
  ])('rejects content with only format characters: %s', (content_html) => {
    expect(() => validateImportedContent(content_html)).toThrow(
      'no readable text or images'
    );
  });

  it.each([
    '<p>&#847;</p>',
    '<p>&#65039;</p>',
  ])('rejects content with only default-ignorable marks: %s', (content_html) => {
    expect(() => validateImportedContent(content_html)).toThrow(
      'no readable text or images'
    );
  });

  it('rejects content with only control characters', () => {
    const bell = String.fromCharCode(7);
    expect(() => validateImportedContent(`<p>${bell}</p>`)).toThrow(
      'no readable text or images'
    );
  });

  it('stores rendered HTML for accepted markdown handoffs', () => {
    const content = validateImportedContent('# Guide\n\nUseful **advice**.');
    expect(content).toContain('<h1>Guide</h1>');
    expect(content).toContain('<strong>advice</strong>');
    expect(content).not.toContain('# Guide');
  });

  it('passes HTML content through byte-identical', () => {
    const content_html = '<h2>Guide</h2><p>Useful <strong>advice</strong></p>';
    expect(validateImportedContent(content_html)).toBe(content_html);
  });

  it('stores the rendered link for bare-URL autolinks', () => {
    const content = validateImportedContent('Visit https://example.com');
    expect(content).toContain('<a href="https://example.com"');
  });

  it('stores the rendered link when a bare URL joins an existing anchor', () => {
    // The raw input already contains one anchor, but rendering adds a
    // second for the bare URL: presence alone would store the raw
    // markup and drop the new link from the published page.
    const content = validateImportedContent(
      '<a href="https://a.example">A</a> Visit https://b.example'
    );
    expect(content).toContain('<a href="https://a.example"');
    expect(content).toContain('<a href="https://b.example"');
  });

  it('preserves disallowed HTML inside markdown code examples', () => {
    const content = validateImportedContent(
      'A fenced example:\n\n```html\n<script>alert(1)</script>\n```\n\nAnd `inline <iframe src="x">` code.'
    );
    expect(content).toContain('&lt;script&gt;');
    expect(content).toContain('&lt;iframe');
    expect(content).not.toContain('<script>alert');
  });

  it('still strips real scripts outside markdown code', () => {
    const content = validateImportedContent(
      '<p>Hello</p><script>bad()</script><p>world</p>'
    );
    expect(content).not.toContain('bad()');
    expect(content).toContain('Hello');
  });

  it('still rejects placeholders revealed by markdown rendering', () => {
    expect(() =>
      validateImportedContent(
        '![Cover](https://cdn.example.com/c.png)\n\n{{INLINE_IMAGE_1}}'
      )
    ).toThrow('unresolved inline image placeholders');
  });

  it('ignores src-like text inside other attributes', () => {
    expect(
      validateImportedContent(
        '<p>Body</p><img alt="a src = b > c" src="https://cdn.example.com/a.webp">'
      )
    ).toContain('https://cdn.example.com/a.webp');
  });
});

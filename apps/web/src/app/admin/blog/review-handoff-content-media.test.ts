import { describe, expect, it } from 'vitest';
import { validateImportedContent } from './review-handoff-content';

describe('validateImportedContent media', () => {
  it('accepts transform commas combined with a spaceless candidate separator', () => {
    expect(
      validateImportedContent(
        '<p>Body</p><img src="https://cdn.example.com/a.webp" alt="A" srcset="https://cdn.example.com/image/width=384,quality=70/a.webp 640w,https://cdn.example.com/b.webp 1280w">'
      )
    ).toContain('srcset');
  });

  it('accepts query-style transform commas glued mid-assignment', () => {
    expect(
      validateImportedContent(
        '<p>Body</p><img src="https://cdn.example.com/a.webp" alt="A" srcset="https://cdn.example.com/img?width=384,quality=70/a.webp 640w, https://cdn.example.com/b.webp 1280w">'
      )
    ).toContain('srcset');
  });

  it.each([
    'https://cdn.example.com/a.webp?crop=1,2 1x',
    'https://cdn.example.com/a.webp?scale=1,1.5 2x',
  ])('accepts numeric value lists inside one srcset URL: %s', (srcset) => {
    expect(
      validateImportedContent(
        `<p>Body</p><img src="https://cdn.example.com/a.webp" alt="A" srcset="${srcset}">`
      )
    ).toContain('srcset');
  });

  it('accepts srcset candidates with CDN transform commas', () => {
    expect(
      validateImportedContent(
        '<p>Body</p><img src="https://cdn.example.com/a.webp" alt="A" srcset="https://cdn.example.com/image/width=384,quality=70,format=webp/a.png 640w, https://cdn.example.com/image/width=1280,quality=70,format=webp/a.png 1280w">'
      )
    ).toContain('srcset');
  });

  it('rejects a second srcset URL hidden behind a bare comma', () => {
    expect(() =>
      validateImportedContent(
        '<p>Body</p><img src="https://cdn.example.com/a.webp" alt="A" srcset="https://cdn.example.com/a.webp 1x,http://example.com/evil.png 2x">'
      )
    ).toThrow('must use HTTPS URLs');
  });

  it.each([
    'https://cdn.example.com/a.webp, http://example.com/evil.png 2x',
    'https://cdn.example.com/a.webp,http://example.com/evil.png 2x',
  ])('rejects an http URL glued to a descriptorless srcset candidate: %s', (srcset) => {
    expect(() =>
      validateImportedContent(
        `<p>Body</p><img src="https://cdn.example.com/a.webp" alt="A" srcset="${srcset}">`
      )
    ).toThrow('must use HTTPS URLs');
  });

  it.each([
    'https://cdn.example.com/a.webp,assets/b.webp 2x',
    'https://cdn.example.com/a.webp, assets/b.webp 2x',
    'https://cdn.example.com/a.webp,/b.webp 2x',
    'https://cdn.example.com/a.webp,b.webp 2x',
    'https://cdn.example.com/a.webp,assets/b.webp',
    'https://cdn.example.com/a.webp,asset=broken.webp 2x',
    'https://cdn.example.com/a.webp,format=webp/b.png 640w',
    'data:image/png;base64,iVBORw0KGgo, http://example.com/evil.png 2x',
  ])('rejects a non-https URL hidden behind a descriptorless srcset candidate: %s', (srcset) => {
    expect(() =>
      validateImportedContent(
        `<p>Body</p><img src="https://cdn.example.com/a.webp" alt="A" srcset="${srcset}">`
      )
    ).toThrow('must use HTTPS URLs');
  });

  it.each([
    'https://cdn.example.com/a.webp, https://cdn.example.com/b.webp 2x',
    'https://cdn.example.com/a.webp,https://cdn.example.com/b.webp 2x',
  ])('accepts a split second srcset candidate: %s', (srcset) => {
    expect(
      validateImportedContent(
        `<p>Body</p><img src="https://cdn.example.com/a.webp" alt="A" srcset="${srcset}">`
      )
    ).toContain('srcset');
  });

  it.each([
    'data:image/png;base64,iVBORw0KGgo= 1x, https://cdn.example.com/b.webp 2x',
    'data:image/png;base64,iVBORw0KGgo= 1x,https://cdn.example.com/b.webp 2x',
    'https://cdn.example.com/a.webp 1x, data:image/png;base64,iVBORw0KGgo=',
    'data:image/png;base64,iVBORw0KGgo, https://cdn.example.com/b.webp 2x',
    'data:image/png;base64,iVBORw0KGgo',
  ])('strips embedded data: candidates from srcset instead of storing them: %s', (srcset) => {
    // The sanitizer removes data: candidates (or the whole attribute when
    // nothing valid remains), so no embedded bytes can persist; the
    // validator then accepts the sanitized remainder.
    const content = validateImportedContent(
      `<p>Body</p><img src="https://cdn.example.com/a.webp" alt="A" srcset="${srcset}">`
    );
    expect(content).toContain('https://cdn.example.com/a.webp');
    expect(content).not.toContain('data:');
  });

  it.each([
    'data:image/png;base64,iVBORw0KGgo=',
    'data:image/jpeg;base64,/9j/',
    'data:image/png,not-an-image',
    'data:image/png;base64,aGVsbG8=',
    'data:image/png;base64,!!!',
    'data:image/not-a-real-format,payload',
    'data:image/svg+xml,<svg></svg>',
    'data:text/html,<p>x</p>',
  ])('rejects embedded data: URLs in src even with well-formed payloads: %s', (url) => {
    expect(() =>
      validateImportedContent(`<p>Body</p><img src="${url}" alt="Embedded">`)
    ).toThrow('must use HTTPS URLs');
  });

  it.each([
    '![Photo](http://example.com/photo.png)',
    '![Photo](/relative/photo.png)',
    'See ![Photo][1] below.\n\n[1]: http://example.com/photo.png',
    '![Photo](data:image/png;base64,iVBORw0KGgo=)',
  ])('rejects markdown images that render broken media: %s', (content_html) => {
    expect(() => validateImportedContent(content_html)).toThrow(
      'must use HTTPS URLs'
    );
  });

  it('accepts markdown images with importable media', () => {
    const content = validateImportedContent(
      '![Photo](https://cdn.example.com/photo.png)'
    );
    expect(content).toContain('<img');
    expect(content).not.toContain('![');
  });
});

import { describe, expect, it } from 'vitest';
import { validateImportedContent } from './review-handoff-content';

describe('validateImportedContent media srcset', () => {
  it('rejects transform commas the editor cannot preserve', () => {
    expect(() =>
      validateImportedContent(
        '<p>Body</p><img src="https://cdn.example.com/a.webp" alt="A" srcset="https://cdn.example.com/image/width=384,quality=70/a.webp 640w,https://cdn.example.com/b.webp 1280w">'
      )
    ).toThrow('srcset');
  });

  it('rejects query-style transform srcsets the editor cannot preserve', () => {
    expect(() =>
      validateImportedContent(
        '<p>Body</p><img src="https://cdn.example.com/a.webp" alt="A" srcset="https://cdn.example.com/img?width=384,quality=70/a.webp 640w, https://cdn.example.com/b.webp 1280w">'
      )
    ).toThrow('srcset');
  });

  it.each([
    'https://cdn.example.com/a.webp?crop=1,2 1x',
    'https://cdn.example.com/a.webp?scale=1,1.5 2x',
    'https://cdn.example.com/a.webp?palette=red,blue 1x',
  ])('glues commas, then rejects the unpreservable srcset: %s', (srcset) => {
    expect(() =>
      validateImportedContent(
        `<p>Body</p><img src="https://cdn.example.com/a.webp" alt="A" srcset="${srcset}">`
      )
    ).toThrow('srcset');
  });

  it('rejects CDN transform srcsets the editor cannot preserve', () => {
    expect(() =>
      validateImportedContent(
        '<p>Body</p><img src="https://cdn.example.com/a.webp" alt="A" srcset="https://cdn.example.com/image/width=384,quality=70,format=webp/a.png 640w, https://cdn.example.com/image/width=1280,quality=70,format=webp/a.png 1280w">'
      )
    ).toThrow('srcset');
  });

  it('rejects a second srcset URL after a complete candidate', () => {
    expect(() =>
      validateImportedContent(
        '<p>Body</p><img src="https://cdn.example.com/a.webp" alt="A" srcset="https://cdn.example.com/a.webp 1x,http://example.com/evil.png 2x">'
      )
    ).toThrow('must use HTTPS URLs');
  });

  it.each([
    'https://cdn.example.com/a.webp, http://example.com/evil.png 2x',
    'https://cdn.example.com/a.webp, assets/b.webp 2x',
    'data:image/png;base64,iVBORw0KGgo, http://example.com/evil.png 2x',
  ])('rejects a non-https URL after a comma separator: %s', (srcset) => {
    expect(() =>
      validateImportedContent(
        `<p>Body</p><img src="https://cdn.example.com/a.webp" alt="A" srcset="${srcset}">`
      )
    ).toThrow('must use HTTPS URLs');
  });

  it.each([
    'https://cdn.example.com/path/red,blue.webp 1x',
    'https://cdn.example.com/a.webp,assets/b.webp 2x',
    'https://cdn.example.com/a.webp,/b.webp 2x',
    'https://cdn.example.com/a.webp,b.webp 2x',
    'https://cdn.example.com/a.webp,assets/b.webp',
    'https://cdn.example.com/a.webp,asset=broken.webp 2x',
    'https://cdn.example.com/a.webp,format=webp/b.png 640w',
    'https://cdn.example.com/a.webp,http://example.com/evil.png 2x',
  ])('treats a bare comma as one token, then rejects: %s', (srcset) => {
    // WHATWG splits candidates only at whitespace-adjacent commas; a bare
    // comma belongs to the URL token, so the joined absolute URL passes
    // media validation as one candidate — then rejects under the editor
    // rule, which the 'srcset' (not HTTPS) error proves.
    expect(() =>
      validateImportedContent(
        `<p>Body</p><img src="https://cdn.example.com/a.webp" alt="A" srcset="${srcset}">`
      )
    ).toThrow('srcset');
  });

  it.each([
    'https://cdn.example.com/a.webp, https://cdn.example.com/b.webp 2x',
    'https://cdn.example.com/a.webp,https://cdn.example.com/b.webp 2x',
  ])('rejects a split second srcset candidate: %s', (srcset) => {
    expect(() =>
      validateImportedContent(
        `<p>Body</p><img src="https://cdn.example.com/a.webp" alt="A" srcset="${srcset}">`
      )
    ).toThrow('srcset');
  });

  it.each([
    'data:image/png;base64,iVBORw0KGgo= 1x, https://cdn.example.com/b.webp 2x',
    'data:image/png;base64,iVBORw0KGgo= 1x,https://cdn.example.com/b.webp 2x',
    'https://cdn.example.com/a.webp 1x, data:image/png;base64,iVBORw0KGgo=',
    'data:image/png;base64,iVBORw0KGgo, https://cdn.example.com/b.webp 2x',
    'data:image/png;base64,iVBORw0KGgo',
  ])('rejects embedded data: URLs in srcset: %s', (srcset) => {
    // The pre-sanitization media check rejects loudly; the sanitizer would
    // otherwise strip these candidates and silently persist a crippled image.
    expect(() =>
      validateImportedContent(
        `<p>Body</p><img src="https://cdn.example.com/a.webp" alt="A" srcset="${srcset}">`
      )
    ).toThrow('must use HTTPS URLs');
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

  it.each([
    'https://cdn.example.com/a.webp 0w',
    'https://cdn.example.com/a.webp 0x',
    'https://cdn.example.com/a.webp 1.5w',
    'https://cdn.example.com/a.webp 1x 2x',
    'https://cdn.example.com/a.webp 100h',
    'https://cdn.example.com/a.webp two-x',
    'https://cdn.example.com/a.webp 2X',
    'https://cdn.example.com/a.webp 1e999x',
  ])('rejects srcset candidates with invalid descriptors: %s', (srcset) => {
    expect(() =>
      validateImportedContent(
        `<p>Body</p><img alt="A" src="https://cdn.example.com/a.png" srcset="${srcset}">`
      )
    ).toThrow('must use HTTPS URLs');
  });

  it.each([
    'https://cdn.example.com/a.webp 1.5x',
    'https://cdn.example.com/a.webp 1e3x',
    'https://cdn.example.com/a.webp 100w',
    'https://cdn.example.com/a.webp .5x',
  ])('rejects srcset candidates with valid descriptors: %s', (srcset) => {
    expect(() =>
      validateImportedContent(
        `<p>Body</p><img alt="A" src="https://cdn.example.com/a.png" srcset="${srcset}">`
      )
    ).toThrow('srcset');
  });

  it('rejects img srcsets the editor cannot preserve', () => {
    // Tiptap image nodes keep src/alt/title/width/height only: the
    // first body edit serializes just the fallback, silently dropping
    // responsive assets validation explicitly retained.
    expect(() =>
      validateImportedContent(
        '<img src="https://cdn.example.com/fallback.png" srcset="https://cdn.example.com/mobile.webp 480w, https://cdn.example.com/desktop.webp 1200w" sizes="100vw" alt="A">'
      )
    ).toThrow('srcset');
  });
});

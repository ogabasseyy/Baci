import { describe, expect, it } from 'vitest';
import { validateImportedContent } from './review-handoff-content';

describe('validateImportedContent media', () => {
  it.each([
    '<img src="https://cdn.example.com/a.png" width="0" height="0">',
    '<img src="https://cdn.example.com/a.png" width="0">',
    '<img src="https://cdn.example.com/a.png" height="0">',
    '<img src="https://cdn.example.com/a.png" width=0 height=0>',
  ])('disregards zero-sized images as readable content: %s', (img) => {
    expect(() => validateImportedContent(img)).toThrow(
      'no readable text or images'
    );
  });

  it.each([
    '<img class="hidden" src="https://cdn.example.com/a.png">',
    '<img class="mb-4 hidden rounded" src="https://cdn.example.com/a.png">',
    '<img class="invisible" src="https://cdn.example.com/a.png">',
    '<img class="opacity-0" src="https://cdn.example.com/a.png">',
  ])('disregards CSS-hidden images as readable content: %s', (img) => {
    expect(() => validateImportedContent(img)).toThrow(
      'no readable text or images'
    );
  });

  it.each([
    '<div class="hidden"><img src="https://cdn.example.com/a.png"></div>',
    '<span class="invisible"><p><img src="https://cdn.example.com/a.png"></p></span>',
  ])('disregards images inside hidden ancestors: %s', (body) => {
    expect(() => validateImportedContent(body)).toThrow(
      'no readable text or images'
    );
  });

  it.each([
    '<div class="hidden">Only body</div>',
    '<div class="invisible"><p>Only <strong>body</strong></p></div>',
    '<div class="opacity-0">Only body</div>',
    '<p class="text-transparent">Only body</p>',
    '<div class="sr-only">Only body</div>',
  ])('disregards text inside hidden ancestors: %s', (body) => {
    expect(() => validateImportedContent(body)).toThrow(
      'no readable text or images'
    );
  });

  it('ignores media-like markup inside HTML comments', () => {
    // The comment is editorial, not rendered: its non-HTTPS draft URL
    // must not reject the handoff.
    expect(
      validateImportedContent(
        '<p>Visible body</p><!-- <img src="http://example.com/draft.png"> -->'
      )
    ).toContain('Visible body');
  });

  it('does not count a commented-out image as readable content', () => {
    // The sanitizer discards the comment, so a comment-only body is
    // empty after sanitization; the readability half is pinned at the
    // hasReadableContent level in review-handoff-readability.test.ts.
    expect(() =>
      validateImportedContent(
        '<!-- <img src="https://cdn.example.com/a.png"> -->'
      )
    ).toThrow('Article content is empty after sanitization');
  });

  it('counts visible text alongside hidden text as readable', () => {
    expect(
      validateImportedContent(
        '<div class="hidden">Hidden</div><p>Visible body</p>'
      )
    ).toContain('Visible body');
  });

  it('counts an image outside a closed hidden element as readable', () => {
    expect(
      validateImportedContent(
        '<div class="hidden"><img src="https://cdn.example.com/a.png"></div><img src="https://cdn.example.com/b.png">'
      )
    ).toContain('b.png');
  });

  it.each([
    '<img class="text-transparent" src="https://cdn.example.com/a.png">',
    '<div class="text-transparent"><img src="https://cdn.example.com/a.png"></div>',
  ])('counts images under text-color-only hiding as readable: %s', (body) => {
    // text-transparent sets color: transparent, which hides glyphs but
    // not decoded image pixels.
    expect(validateImportedContent(body)).toContain('<img');
  });

  it('accepts media URLs with encoded character references', () => {
    expect(
      validateImportedContent(
        '<p>Body</p><img src="https&#58;//cdn.example.com/a.png" alt="A">'
      )
    ).toContain('cdn.example.com/a.png');
  });

  it('counts an image with a merely similar class name as readable', () => {
    expect(
      validateImportedContent(
        '<img class="unhidden" src="https://cdn.example.com/a.png">'
      )
    ).toContain('<img');
  });

  it('counts a sized image as readable content', () => {
    expect(
      validateImportedContent(
        '<img src="https://cdn.example.com/a.png" width="100" height="100">'
      )
    ).toContain('<img');
  });

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
    'https://cdn.example.com/a.webp?palette=red,blue 1x',
  ])('glues commas inside one srcset query string: %s', (srcset) => {
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
  ])('treats a bare comma as part of one srcset URL token: %s', (srcset) => {
    // WHATWG splits candidates only at whitespace-adjacent commas; a bare
    // comma belongs to the URL token, so the joined absolute URL validates
    // as one candidate instead of a relative second one.
    expect(
      validateImportedContent(
        `<p>Body</p><img src="https://cdn.example.com/a.webp" alt="A" srcset="${srcset}">`
      )
    ).toContain('srcset');
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
      validateImportedContent(`<p>Body</p><img alt="A" srcset="${srcset}">`)
    ).toThrow('must use HTTPS URLs');
  });

  it.each([
    'https://cdn.example.com/a.webp 1.5x',
    'https://cdn.example.com/a.webp 1e3x',
    'https://cdn.example.com/a.webp 100w',
    'https://cdn.example.com/a.webp .5x',
  ])('accepts srcset candidates with valid descriptors: %s', (srcset) => {
    expect(
      validateImportedContent(`<p>Body</p><img alt="A" srcset="${srcset}">`)
    ).toContain('srcset');
  });

  it('accepts markdown images with importable media', () => {
    const content = validateImportedContent(
      '![Photo](https://cdn.example.com/photo.png)'
    );
    expect(content).toContain('<img');
    expect(content).not.toContain('![');
  });
});

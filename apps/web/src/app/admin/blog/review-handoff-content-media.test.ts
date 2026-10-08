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
    '<div class="max-h-0 overflow-hidden"><img src="https://cdn.example.com/a.png"></div>',
    '<div class="h-0 overflow-hidden"><img src="https://cdn.example.com/a.png"></div>',
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
    '<div class="max-h-0 overflow-hidden">Only body</div>',
    '<div class="h-0 overflow-hidden">Only body</div>',
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

  it('ignores media-like text inside another element quoted attribute', () => {
    // The <img> text is the div's title, not an element: its HTTP URL
    // must not reject the handoff.
    expect(
      validateImportedContent(
        `<div title="<img src='http://example.com/draft.png'>">Readable</div>`
      )
    ).toContain('Readable');
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

  it.each([
    '<div class="max-h-0">Only body</div>',
    '<div class="h-0">Only body</div>',
    '<div class="overflow-hidden">Only body</div>',
  ])('counts partial clip utilities without their partner as readable: %s', (body) => {
    // max-h-0 alone does not clip (content overflows visibly) and
    // overflow-hidden alone does not zero the height: only the pair
    // hides, so each half stays readable on its own.
    expect(validateImportedContent(body)).toContain('Only body');
  });

  it('counts a visible paragraph inside an invisible ancestor as readable', () => {
    // visibility inherits but the child's `visible` utility overrides
    // it, so the paragraph renders and the handoff must not be rejected.
    expect(
      validateImportedContent(
        '<div class="invisible"><p class="visible">Readable</p></div>'
      )
    ).toContain('Readable');
  });

  it('counts a visible image inside an invisible ancestor as readable', () => {
    expect(
      validateImportedContent(
        '<div class="invisible"><img class="visible" src="https://cdn.example.com/a.png"></div>'
      )
    ).toContain('a.png');
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

  it('accepts markdown images with importable media', () => {
    const content = validateImportedContent(
      '![Photo](https://cdn.example.com/photo.png)'
    );
    expect(content).toContain('<img');
    expect(content).not.toContain('![');
  });
});

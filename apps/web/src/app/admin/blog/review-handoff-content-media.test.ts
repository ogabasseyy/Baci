import { describe, expect, it } from 'vitest';
import { validateImportedContent } from './review-handoff-content';

describe('validateImportedContent media', () => {
  it.each([
    '<img src="https://cdn.example.com/a.png" width="0" height="0">',
    '<img src="https://cdn.example.com/a.png" width="0">',
    '<img src="https://cdn.example.com/a.png" height="0">',
    '<img src="https://cdn.example.com/a.png" width=0 height=0>',
    '<img class="max-h-0 md:h-auto" src="https://cdn.example.com/a.png">',
    '<img class="h-0 md:h-0" src="https://cdn.example.com/a.png">',
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
    '<div class="w-0 overflow-hidden"><img src="https://cdn.example.com/a.png"></div>',
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
    '<div class="w-0 overflow-hidden">Only body</div>',
    '<div class="max-w-0 overflow-hidden">Only body</div>',
    '<div class="h-0 overflow-y-hidden">Only body</div>',
    '<div class="w-0 overflow-x-hidden">Only body</div>',
    '<div class="hidden md:hidden">Only body</div>',
    '<div class="opacity-0 md:opacity-0">Only body</div>',
    '<div class="invisible md:invisible">Only body</div>',
    '<div class="invisible md:block">Only body</div>',
    '<div class="hidden md:visible">Only body</div>',
    '<div class="hidden"><p class="md:block">Only body</p></div>',
    '<div class="opacity-0"><p class="md:opacity-100">Only body</p></div>',
    '<div class="sr-only"><p class="md:not-sr-only">Only body</p></div>',
    '<div class="hidden md:block md:hidden">Only body</div>',
    '<div class="max-h-0 overflow-hidden md:h-auto">Only body</div>',
    '<div class="w-0 overflow-hidden md:h-64">Only body</div>',
    '<div class="h-0 overflow-hidden md:h-0">Only body</div>',
    '<div class="text-transparent"><p class="text-black/0">Only body</p></div>',
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

  it.each([
    '<p>Body</p><script>const draft = \'<img src="http://example.com/draft.png">\'</script>',
    '<p>Body</p><style>/* <img src="http://example.com/draft.png"> */</style>',
    '<p>Body</p><script>const draft = \'<img src="http://example.com/draft.png">\'',
  ])('ignores media-like text inside raw-text elements: %s', (body) => {
    // Raw-text contents are never parsed as elements, and the
    // sanitizer strips the blocks from the stored article, so the
    // draft URL inside must not reject the handoff.
    expect(validateImportedContent(body)).toContain('Body');
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
    '<div class="w-0">Only body</div>',
    '<div class="overflow-hidden">Only body</div>',
    '<div class="h-0 overflow-x-hidden">Only body</div>',
    '<div class="w-0 overflow-y-hidden">Only body</div>',
  ])('counts partial clip utilities without their partner as readable: %s', (body) => {
    // A zeroed axis alone does not clip (content overflows visibly)
    // and overflow-hidden alone zeroes nothing: only a zeroed axis
    // paired with clipping on that same axis hides, so each half —
    // and each cross-axis pairing — stays readable on its own.
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

  it.each([
    '<div class="hidden md:block">Only body</div>',
    '<div class="opacity-0 lg:opacity-100">Only body</div>',
    '<div class="invisible sm:visible">Only body</div>',
    '<div class="sr-only md:not-sr-only">Only body</div>',
    '<div class="invisible"><p class="md:visible">Only body</p></div>',
    '<div class="text-transparent"><p class="md:text-black">Only body</p></div>',
    '<div class="h-0 overflow-hidden md:h-auto">Only body</div>',
    '<div class="w-0 overflow-hidden md:w-full">Only body</div>',
    '<div class="max-h-0 overflow-hidden md:max-h-none">Only body</div>',
    '<div class="size-0 overflow-hidden md:size-64">Only body</div>',
    '<div class="hidden md:block lg:hidden">Only body</div>',
  ])('counts responsive overrides of hiding utilities as readable: %s', (body) => {
    // Each pair renders at some breakpoint: same-element responsive
    // overrides restore display, visibility, opacity, screen-reader
    // hiding, and text color, while visibility and color also inherit,
    // so responsive descendants escape transparent ancestors too.
    expect(validateImportedContent(body)).toContain('Only body');
  });

  it.each([
    '<img class="h-0 md:h-auto" src="https://cdn.example.com/a.png">',
    '<img class="md:w-full" src="https://cdn.example.com/a.png" width="0">',
  ])('counts images with responsive size restoration as readable: %s', (body) => {
    // CSS beats presentational attributes, so a responsive size
    // utility restores zeroed class tokens and zero width/height
    // attributes alike at its breakpoint.
    expect(validateImportedContent(body)).toContain('<img');
  });

  it('counts opaque text inside a transparent ancestor as readable', () => {
    // color inherits but the child's opaque text utility overrides
    // it, so the paragraph renders and the handoff must not be rejected.
    expect(
      validateImportedContent(
        '<div class="text-transparent"><p class="text-black">Readable</p></div>'
      )
    ).toContain('Readable');
  });

  it.each([
    '<div class="text-transparent"><p class="text-foreground">Readable</p></div>',
    '<div class="text-transparent"><p class="text-muted-foreground">Readable</p></div>',
  ])('counts semantic theme text inside a transparent ancestor as readable: %s', (body) => {
    // Theme color utilities from the app palette override inherited
    // transparency exactly like palette colors do.
    expect(validateImportedContent(body)).toContain('Readable');
  });

  it('disregards a zero-height image without any overflow rule', () => {
    // A replaced image with h-0 renders zero pixels on its own: unlike
    // container content, it needs no overflow-hidden to vanish.
    expect(() =>
      validateImportedContent(
        '<img class="h-0" src="https://cdn.example.com/a.png">'
      )
    ).toThrow('no readable text or images');
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

import { describe, expect, it } from 'vitest';
import { stripHiddenContent } from './review-handoff-strip-hidden';

describe('stripHiddenContent', () => {
  it.each([
    [
      '<p class="hidden">Draft note</p><p>Visible article</p>',
      '<p>Visible article</p>',
    ],
    ['<div class="hidden"><p>Nested</p></div><p>Visible</p>', '<p>Visible</p>'],
    [
      '<img class="hidden" src="https://cdn.example.com/a.png"><p>Visible</p>',
      '<p>Visible</p>',
    ],
    [
      '<div class="hidden md:block">Shown</div>',
      '<div class="hidden md:block">Shown</div>',
    ],
    [
      '<p class="invisible">Draft note</p><p>Visible article</p>',
      '<p>Visible article</p>',
    ],
    [
      '<p class="text-transparent">Draft note</p><p>Visible article</p>',
      '<p>Visible article</p>',
    ],
    [
      '<div class="invisible"><p>Note</p><p class="visible">Keep</p></div>',
      '<div class="invisible"><p class="visible">Keep</p></div>',
    ],
    [
      '<div class="invisible">Direct text<p class="visible">Keep</p></div>',
      '<div class="invisible"><p class="visible">Keep</p></div>',
    ],
    [
      '<div class="text-transparent"><img src="https://cdn.example.com/a.png"></div>',
      '<div class="text-transparent"><img src="https://cdn.example.com/a.png"></div>',
    ],
    [
      '<img class="invisible" src="https://cdn.example.com/a.png"><p>V</p>',
      '<p>V</p>',
    ],
    [
      '<p class="invisible md:visible">Note</p>',
      '<p class="invisible md:visible">Note</p>',
    ],
    [
      '<div class="text-transparent"><p class="text-[#B76E79]">Only body</p></div>',
      '<div class="text-transparent"><p class="text-[#B76E79]">Only body</p></div>',
    ],
    ['<p>Untouched</p>', '<p>Untouched</p>'],
    [
      '<div class="hidden dark:block">Dark</div><p>Kept</p>',
      '<div class="hidden dark:block">Dark</div><p>Kept</p>',
    ],
    ['<div class="hidden dark:hidden">Gone</div><p>Kept</p>', '<p>Kept</p>'],
  ])('strips only always-hidden subtrees: %s', (content, expected) => {
    expect(stripHiddenContent(content)).toBe(expected);
  });

  it('keeps source elements despite their own hiding classes', () => {
    // CSS display utilities on a source element do not participate in
    // the browser's picture resource-selection algorithm, so the
    // source stays selectable and must survive the strip.
    const picture =
      '<picture><source class="hidden" srcset="https://cdn.example.com/mobile.webp"><img src="https://cdn.example.com/fallback.png"></picture>';
    expect(stripHiddenContent(picture)).toBe(picture);
  });

  it('rebuilds deeply nested markup in linear time', { timeout: 15000 }, () => {
    // The rebuild must reuse the propagated drop flags instead of
    // re-scanning the open stack per tag.
    const depth = 80000;
    const open = '<div>'.repeat(depth);
    const close = '</div>'.repeat(depth);
    expect(stripHiddenContent(`${open}Deep article${close}`)).toBe(
      `${open}Deep article${close}`
    );
  });

  it('strips hidden leaves in deeply nested markup', () => {
    // Hiddenness must propagate down the stack in one traversal:
    // rebuilding the ancestor chain per element turns deep valid
    // articles into a quadratic import freeze.
    const depth = 1500;
    const open = '<div>'.repeat(depth);
    const close = '</div>'.repeat(depth);
    expect(
      stripHiddenContent(
        `${open}<p class="hidden">Deep</p>${close}<p>Visible</p>`
      )
    ).toBe(`${open}${close}<p>Visible</p>`);
  });
});

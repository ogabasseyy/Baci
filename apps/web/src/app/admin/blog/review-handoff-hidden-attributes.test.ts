import { describe, expect, it } from 'vitest';
import { convertHiddenAttributes } from './review-handoff-hidden-attributes';

describe('convertHiddenAttributes', () => {
  it.each([
    ['<p hidden>Note</p>', '<p hidden class="hidden">Note</p>'],
    ['<p hidden="">Note</p>', '<p hidden="" class="hidden">Note</p>'],
    ['<p hidden="false">Note</p>', '<p hidden="false" class="hidden">Note</p>'],
    [
      '<p hidden class="text-red-500">Note</p>',
      '<p hidden class="text-red-500 hidden">Note</p>',
    ],
    [
      '<p class="md:block" hidden>Note</p>',
      '<p class="md:block hidden" hidden>Note</p>',
    ],
    ['<p>Untouched</p>', '<p>Untouched</p>'],
    ['<P HIDDEN>Note</P>', '<P HIDDEN class="hidden">Note</P>'],
  ])('converts hidden attributes to hiding classes: %s', (html, expected) => {
    expect(convertHiddenAttributes(html)).toBe(expected);
  });

  it.each([
    '<p hidden class="block">Shown</p>',
    '<div hidden class="flex">Shown</div>',
    '<p hidden="hidden" class="block">Shown</p>',
  ])('leaves bare display utilities to decide: %s', (html) => {
    expect(convertHiddenAttributes(html)).toBe(html);
  });

  it.each([
    [
      '<div hidden="until-found" class="block">Draft note</div><p>Body</p>',
      '<div hidden="until-found" class="block hidden">Draft note</div><p>Body</p>',
    ],
    [
      '<p hidden="UNTIL-FOUND" class="flex">Note</p>',
      '<p hidden="UNTIL-FOUND" class="flex hidden">Note</p>',
    ],
  ])('converts until-found despite display classes: %s', (html, expected) => {
    // hidden="until-found" renders through content-visibility, which
    // display utilities do not override; without the conversion the
    // sanitizer drops the attribute and publishes the note.
    expect(convertHiddenAttributes(html)).toBe(expected);
  });

  it.each([
    '<p aria-hidden="true">Decorative</p>',
    '<p data-hidden="yes">Kept</p>',
    '<p title="a hidden thing">Kept</p>',
    '<p data-hidden>Kept</p>',
  ])('ignores hidden lookalikes: %s', (html) => {
    expect(convertHiddenAttributes(html)).toBe(html);
  });

  it('merges hidden into an unquoted class without a duplicate attribute', () => {
    // The browser keeps the first of duplicate class attributes, so an
    // appended second class would silently drop the hiding marker.
    const converted = convertHiddenAttributes(
      '<p hidden class=note>Draft note</p><p>Visible article</p>'
    );
    expect(converted).toBe(
      '<p hidden class="note hidden">Draft note</p><p>Visible article</p>'
    );
    expect(converted.match(/class=/g)).toHaveLength(1);
  });
});

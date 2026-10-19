import { describe, expect, it } from 'vitest';
import { validateImportedContent } from './review-handoff-content';
import { hasUnrepresentableHiddenWrapper } from './review-handoff-disallowed-wrapper';

describe('hasUnrepresentableHiddenWrapper', () => {
  it.each([
    '<section class="hidden"><p>Draft note</p></section><p>Body</p>',
    '<article class="invisible"><p>Draft note</p></article>',
    '<aside class="md:hidden"><p>Draft note</p></aside>',
    '<SECTION CLASS="hidden"><p>Draft note</p></SECTION>',
    '<header class="opacity-0"><p>Draft note</p></header>',
    '<footer class="!hidden"><p>Draft note</p></footer>',
    '<div class="invisible"><section class="visible"><p>Kept</p></section></div>',
  ])('flags channel markers on unwrapped tags: %s', (html) => {
    expect(hasUnrepresentableHiddenWrapper(html)).toBe(true);
  });

  it.each([
    '<section><p>Visible article</p></section>',
    '<section class="p-4"><p>Visible article</p></section>',
    '<div class="hidden"><p>Gone</p></div><p>Body</p>',
    '<section><div class="hidden"><p>Gone</p></div></section><p>Body</p>',
    '<!-- <section class="hidden"><p>Note</p></section> --><p>Body</p>',
    '</section>',
  ])('ignores representable markup: %s', (html) => {
    expect(hasUnrepresentableHiddenWrapper(html)).toBe(false);
  });

  it('rejects a hidden section wrapper at import', () => {
    expect(() =>
      validateImportedContent(
        '<section class="hidden"><p>Draft note</p></section><p>Body</p>'
      )
    ).toThrow('hidden wrapper markup the editor cannot preserve');
  });

  it('imports a plain section wrapper', () => {
    expect(validateImportedContent('<section><p>Body</p></section>')).toContain(
      'Body'
    );
  });
});

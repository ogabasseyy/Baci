import { describe, expect, it } from 'vitest';
import { validateImportedContent } from './review-handoff-content';
import { stripTemplateSubtrees } from './review-handoff-template-strip';

describe('stripTemplateSubtrees', () => {
  it.each([
    [
      '<template><p>Draft note</p></template><p>Visible article</p>',
      '<p>Visible article</p>',
    ],
    [
      '<template id="t"><template><p>Deep</p></template></template><p>Kept</p>',
      '<p>Kept</p>',
    ],
    ['<template><p>Unclosed note', ''],
    // A template opener inside comment text is not markup: the scan
    // must not treat it as an unclosed template and discard the body.
    ['<!-- <template> note --><p>Visible body</p>', '<p>Visible body</p>'],
    // A stray close parses to nothing; the sanitizer would have
    // discarded the passed-through tag anyway.
    ['<p>Visible</p></template>', '<p>Visible</p>'],
    ['<p>Untouched</p>', '<p>Untouched</p>'],
    ['<template></template>', ''],
  ])('strips inert template subtrees: %s', (html, expected) => {
    expect(stripTemplateSubtrees(html)).toBe(expected);
  });

  it('drops template contents at import instead of surfacing them', () => {
    // The sanitizer discards the disallowed template wrapper but keeps
    // its allowed descendants, so inert notes would publish unless the
    // subtree is stripped before sanitization.
    expect(
      validateImportedContent(
        '<template><p>Draft note</p></template><p>Visible article</p>'
      )
    ).toBe('<p>Visible article</p>');
  });

  it('keeps the body when a comment holds an unclosed template opener', () => {
    expect(
      validateImportedContent('<!-- <template> note --><p>Visible body</p>')
    ).toBe('<p>Visible body</p>');
  });

  it('ignores template text inside raw-text elements', () => {
    // The parser treats the opener as script text, so no template
    // element exists and nothing is stripped; the sanitizer then
    // discards the script while retaining the paragraph. A lexical
    // walk would see an unclosed template and drop the body.
    const html =
      '<script>const sample="<template>"</script><p>Visible body</p>';
    // The leading script parses into head; the body keeps its
    // paragraph instead of being dropped as unclosed-template text.
    expect(stripTemplateSubtrees(html)).toBe('<p>Visible body</p>');
    expect(validateImportedContent(html)).toBe('<p>Visible body</p>');
  });
});

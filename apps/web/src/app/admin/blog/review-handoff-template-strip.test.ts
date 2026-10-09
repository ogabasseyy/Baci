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
    ['<p>Visible</p></template>', '<p>Visible</p></template>'],
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
});

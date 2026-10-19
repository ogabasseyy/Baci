import { describe, expect, it } from 'vitest';
import { validateImportedContent } from './review-handoff-content';
import { stripNoscriptSubtrees } from './review-handoff-noscript-strip';

describe('stripNoscriptSubtrees', () => {
  it.each([
    ['<noscript><p>Draft note</p></noscript><p>Body</p>', '<p>Body</p>'],
    [
      '<noscript><noscript><p>Deep</p></noscript></noscript><p>Kept</p>',
      '<p>Kept</p>',
    ],
    ['<noscript><p>Unclosed note', ''],
    // A noscript opener inside comment text is not markup: the scan
    // must not treat it as an unclosed noscript and discard the body.
    ['<!-- <noscript> note --><p>Visible body</p>', '<p>Visible body</p>'],
    ['<p>Visible</p></noscript>', '<p>Visible</p></noscript>'],
    ['<p>Untouched</p>', '<p>Untouched</p>'],
    ['<noscript></noscript>', ''],
  ])('strips inert noscript subtrees: %s', (html, expected) => {
    expect(stripNoscriptSubtrees(html)).toBe(expected);
  });

  it('drops noscript contents at import instead of surfacing them', () => {
    // The sanitizer discards the disallowed noscript wrapper but keeps
    // its allowed descendants, so script-disabled fallback notes would
    // publish unless the subtree is stripped before sanitization.
    expect(
      validateImportedContent(
        '<noscript><p>Draft note</p></noscript><p>Body</p>'
      )
    ).toBe('<p>Body</p>');
  });

  it('keeps the body when a comment holds an unclosed noscript opener', () => {
    expect(
      validateImportedContent('<!-- <noscript> note --><p>Visible body</p>')
    ).toBe('<p>Visible body</p>');
  });

  it('ignores noscript openers inside raw-text elements', () => {
    // The parser treats the opener as script text; the sanitizer
    // then discards the script while retaining the paragraph. A raw
    // lexical walk would see an unclosed noscript and drop the body.
    expect(
      validateImportedContent(
        '<script>const sample="<noscript>"</script><p>Visible body</p>'
      )
    ).toBe('<p>Visible body</p>');
  });

  it('strips noscript before the DOM-based template strip parses', () => {
    // Parsing promotes noscript children to markup, so the lexical
    // noscript strip must run on unparsed input first; otherwise the
    // wrapper is gone before it is seen and inert notes publish.
    expect(
      validateImportedContent(
        '<noscript><template><p>Deep note</p></template></noscript><p>Body</p>'
      )
    ).toBe('<p>Body</p>');
    expect(
      validateImportedContent(
        '<template><noscript><p>Deep note</p></noscript></template><p>Body</p>'
      )
    ).toBe('<p>Body</p>');
  });
});

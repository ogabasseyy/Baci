import { describe, expect, it } from 'vitest';
import { validateImportedContent } from './review-handoff-content';
import { stripNonRenderedSvgSubtrees } from './review-handoff-svg-strip';

describe('stripNonRenderedSvgSubtrees', () => {
  it('drops the exact svg desc case at import', () => {
    expect(
      validateImportedContent('<svg><desc>Draft note</desc></svg><p>Body</p>')
    ).toBe('<p>Body</p>');
  });

  it.each([
    '<svg><title>Draft note</title></svg><p>Body</p>',
    '<svg><metadata>Draft note</metadata></svg><p>Body</p>',
    '<svg><defs><circle id="c" /></defs></svg><p>Body</p>',
  ])('drops never-rendered svg metadata at import: %s', (html) => {
    expect(validateImportedContent(html)).toBe('<p>Body</p>');
  });

  it('keeps genuinely painted svg text', () => {
    // The browser paints svg text, so unwrapping it into article
    // text preserves visible content rather than leaking notes.
    expect(validateImportedContent('<svg><text>Shown</text></svg>')).toBe(
      'Shown'
    );
  });

  it('leaves markup without svg metadata untouched', () => {
    const html = '<p>Untouched</p>';
    expect(stripNonRenderedSvgSubtrees(html)).toBe(html);
  });
});

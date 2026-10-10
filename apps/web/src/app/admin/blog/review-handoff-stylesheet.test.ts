import { describe, expect, it } from 'vitest';
import { validateImportedContent } from './review-handoff-content';
import { hasUnpreservableStylesheet } from './review-handoff-stylesheet';

describe('hasUnpreservableStylesheet', () => {
  it.each([
    '<style>.draft{display:none}</style><p class="draft">Draft note</p><p>Body</p>',
    '<STYLE>.draft{display:none}</STYLE>',
    '<style media="screen">p{display:none}</style>',
    '<link rel="stylesheet" href="https://cdn.example.com/a.css">',
    '<link rel="alternate stylesheet" href="https://cdn.example.com/a.css">',
  ])('flags stylesheet dependencies: %s', (html) => {
    expect(hasUnpreservableStylesheet(html)).toBe(true);
  });

  it.each([
    '<p>Visible article</p>',
    '<a rel="stylesheet" href="https://example.com">Not a link tag</a>',
    '<link rel="icon" href="https://cdn.example.com/a.ico">',
    '<link href="https://cdn.example.com/a.css">',
    '<!-- <style>.draft{display:none}</style> --><p>Body</p>',
    '<style></style><p>Body</p>',
    '<p>Body</p><style>/* <img src="http://example.com/draft.png"> */</style>',
    '</style>',
  ])('ignores non-stylesheet markup: %s', (html) => {
    expect(hasUnpreservableStylesheet(html)).toBe(false);
  });

  it('rejects a stylesheet-hidden note at import', () => {
    expect(() =>
      validateImportedContent(
        '<style>.draft{display:none}</style><p class="draft">Draft note</p><p>Body</p>'
      )
    ).toThrow('stylesheet markup the editor cannot preserve');
  });

  it('leaves style samples inside fenced code verbatim', () => {
    const stored = validateImportedContent(
      '```html\n<style>.draft{display:none}</style>\n```\n\nVisible article'
    );
    expect(stored).toContain('&lt;style&gt;');
  });
});

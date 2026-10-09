import { describe, expect, it } from 'vitest';
import { validateImportedContent } from './review-handoff-content';
import { convertHiddenInlineStyles } from './review-handoff-inline-styles';

describe('inline styles custom properties', () => {
  it('resolves the exact var() hiding case at import', () => {
    expect(
      validateImportedContent(
        '<p style="--state:none;display:var(--state)">Draft note</p><p>Body</p>'
      )
    ).toBe('<p>Body</p>');
  });

  it.each([
    // Fallbacks apply when the property is missing...
    '<p style="display:var(--missing,none)">Draft note</p><p>Body</p>',
    // ...and through chained references.
    '<p style="--a:var(--b);--b:hidden;visibility:var(--a)">Draft note</p><p>Body</p>',
    // Nested fallbacks resolve inside out.
    '<p style="display:var(--a,var(--b,none))">Draft note</p><p>Body</p>',
    // Custom values stay verbatim so case-sensitive names resolve.
    '<p style="--Hide:none;--state:var(--Hide);display:var(--state)">Draft note</p><p>Body</p>',
    // Keywords still match case-insensitively after resolution.
    '<p style="Display:None">Draft note</p><p>Body</p>',
  ])('strips var()-hidden content at import: %s', (html) => {
    expect(validateImportedContent(html)).toBe('<p>Body</p>');
  });

  it.each([
    // Inherited customs resolve: the browser hides the paragraph;
    // the emptied shells are not themselves hidden, so they stay.
    [
      '<div style="--state:none"><p style="display:var(--state)">Draft note</p></div><p>Body</p>',
      '<div></div><p>Body</p>',
    ],
    // The closest ancestor wins over the outer one.
    [
      '<div style="--state:block"><div style="--state:none"><p style="display:var(--state)">Draft note</p></div></div><p>Body</p>',
      '<div><div></div></div><p>Body</p>',
    ],
  ])('strips inherited var()-hidden content: %s', (html, expected) => {
    expect(validateImportedContent(html)).toBe(expected);
  });

  it.each([
    // Cyclic chains are guaranteed-invalid: the declaration stays
    // visible, exactly like the browser.
    '<p style="--a:var(--b);--b:var(--a);display:var(--a)">Shown</p>',
    // Custom names are case-sensitive: --State never feeds var(--state).
    '<p style="--State:none;display:var(--state)">Shown</p>',
    // An unresolvable reference with no fallback matches nothing hiding.
    '<p style="display:var(--missing)">Shown</p>',
    // The own block overrides an inherited hiding value.
    '<div style="--state:none"><p style="--state:block;display:var(--state)">Shown</p></div>',
  ])('leaves unresolvable var() references visible: %s', (html) => {
    expect(convertHiddenInlineStyles(html)).toBe(html);
  });
});

import { describe, expect, it } from 'vitest';
import { validateImportedContent } from './review-handoff-content';
import { stripImportantModifier } from './review-handoff-important';

describe('stripImportantModifier', () => {
  it.each([
    ['hidden!', 'hidden'],
    ['!hidden', 'hidden'],
    ['md:hidden!', 'md:hidden'],
    ['md:!hidden', 'md:hidden'],
    ['max-[600px]:hidden!', 'max-[600px]:hidden'],
    ['hidden', 'hidden'],
    ['md:block', 'md:block'],
    ["content-['!']", "content-['!']"],
    ['supports-[display:grid]:hidden', 'supports-[display:grid]:hidden'],
  ])('normalizes important modifiers: %s', (token, expected) => {
    expect(stripImportantModifier(token)).toBe(expected);
  });

  it('strips trailing-important hiding at import', () => {
    expect(
      validateImportedContent(
        '<p class="hidden!">Draft note</p><p>Visible article</p>'
      )
    ).toBe('<p>Visible article</p>');
  });

  it('strips compatibility-form important hiding at import', () => {
    expect(
      validateImportedContent(
        '<p class="!hidden">Draft note</p><p>Visible article</p>'
      )
    ).toBe('<p>Visible article</p>');
  });

  it('flags responsive showing through important modifiers', () => {
    expect(() =>
      validateImportedContent(
        '<p class="hidden md:block!">Desktop note</p><p>Visible article</p>'
      )
    ).toThrow('responsive visibility');
  });
});

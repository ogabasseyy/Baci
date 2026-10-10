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

  it('keeps visible content when important showing beats plain hiding', () => {
    expect(
      validateImportedContent(
        '<p class="hidden block!">Visible note</p><p>Body</p>'
      )
    ).toBe('<p class="hidden block!">Visible note</p><p>Body</p>');
  });

  it('strips content when important hiding beats plain showing', () => {
    expect(
      validateImportedContent('<p class="block hidden!">Draft</p><p>Body</p>')
    ).toBe('<p>Body</p>');
  });

  it('keeps content when important opacity beats plain zero', () => {
    expect(
      validateImportedContent(
        '<p class="opacity-0 opacity-100!">Visible note</p><p>Body</p>'
      )
    ).toBe('<p class="opacity-0 opacity-100!">Visible note</p><p>Body</p>');
  });

  it('keeps content when important scale beats plain zero', () => {
    expect(
      validateImportedContent(
        '<p class="scale-0 scale-100!">Visible note</p><p>Body</p>'
      )
    ).toBe('<p class="scale-0 scale-100!">Visible note</p><p>Body</p>');
  });

  it('keeps content when important color beats plain transparency', () => {
    expect(
      validateImportedContent(
        '<p class="text-transparent text-black!">Visible note</p><p>Body</p>'
      )
    ).toBe(
      '<p class="text-transparent text-black!">Visible note</p><p>Body</p>'
    );
  });

  it('keeps content when important size beats plain zero', () => {
    expect(
      validateImportedContent(
        '<p class="h-0 overflow-hidden h-64!">Visible note</p><p>Body</p>'
      )
    ).toBe('<p class="h-0 overflow-hidden h-64!">Visible note</p><p>Body</p>');
  });
});

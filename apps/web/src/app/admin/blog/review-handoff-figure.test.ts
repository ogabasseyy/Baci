import { describe, expect, it } from 'vitest';
import { defaultExtensions } from '@/components/blog/novel-features/extensions';
import { validateImportedContent } from './review-handoff-content';
import { hasUnpreservableFigure } from './review-handoff-figure';

describe('hasUnpreservableFigure', () => {
  it.each([
    '<figure><img src="https://cdn.example.com/a.png"><figcaption>Caption</figcaption></figure>',
    '<figcaption>Caption</figcaption>',
    '<FIGURE><img src="https://cdn.example.com/a.png"></FIGURE>',
  ])('detects figure markup: %s', (html) => {
    expect(hasUnpreservableFigure(html)).toBe(true);
  });

  it.each([
    '<p>Visible article</p>',
    '<img src="https://cdn.example.com/a.png">',
    '<p class="figure">Not a figure element</p>',
    '<!-- <figure><img src="https://cdn.example.com/a.png"></figure> -->',
    '</figure>',
  ])('ignores non-figure markup: %s', (html) => {
    expect(hasUnpreservableFigure(html)).toBe(false);
  });

  it('rejects figure markup the editor cannot round-trip', () => {
    // The sanitizer keeps figure/figcaption but the editor defines no
    // such nodes, so the first body edit would serialize the image and
    // caption without their figure structure.
    expect(() =>
      validateImportedContent(
        '<figure><img src="https://cdn.example.com/a.png"><figcaption>Caption</figcaption></figure>'
      )
    ).toThrow('figure markup');
  });

  it('fails loudly if the editor gains figure nodes', () => {
    // StarterKit ships no figure node (verified in the installed
    // @tiptap/starter-kit); if a figure extension is ever configured,
    // this rejection must be revisited instead of silently kept.
    const names = defaultExtensions.map((extension) => extension.name);
    expect(names).not.toContain('figure');
    expect(names).not.toContain('figcaption');
  });
});

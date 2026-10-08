import { describe, expect, it } from 'vitest';
import { validateImportedContent } from './review-handoff-content';

describe('validateImportedContent picture', () => {
  it('accepts a src-less img supplied by its picture source', () => {
    // The source contributes the image candidate, so the img element
    // does not need its own src; judging it alone would reject valid
    // responsive markup with a misleading HTTPS error.
    expect(
      validateImportedContent(
        '<picture><source srcset="https://cdn.example.com/a.webp"><img alt="A"></picture>'
      )
    ).toContain('<img');
  });

  it('ignores a picture source with an inapplicable type', () => {
    // Browsers skip sources with unsupported types, leaving the
    // src-less img with no candidate: the image-only article renders
    // no pixels and must be rejected.
    expect(() =>
      validateImportedContent(
        '<picture><source type="text/plain" srcset="https://cdn.example.com/a.webp"><img alt="A"></picture>'
      )
    ).toThrow('must use HTTPS URLs');
  });

  it('ignores a picture source with an unsupported image subtype', () => {
    // image/* alone is not enough: browsers skip MIME types they do
    // not support, so an unknown subtype cannot supply the img.
    expect(() =>
      validateImportedContent(
        '<picture><source type="image/x-unknown" srcset="https://cdn.example.com/a.webp"><img alt=""></picture>'
      )
    ).toThrow('must use HTTPS URLs');
  });

  it('accepts a picture source with an applicable image type', () => {
    expect(
      validateImportedContent(
        '<picture><source type="image/webp" srcset="https://cdn.example.com/a.webp"><img alt="A"></picture>'
      )
    ).toContain('<img');
  });

  it('ignores a picture source with an always-false media query', () => {
    // Browsers never match `not all`, leaving the src-less img with
    // no candidate: the image-only article renders blank and must be
    // rejected.
    expect(() =>
      validateImportedContent(
        '<picture><source media="not all" srcset="https://cdn.example.com/a.webp"><img alt=""></picture>'
      )
    ).toThrow('must use HTTPS URLs');
  });

  it('ignores a picture source with a syntactically invalid media query', () => {
    // Invalid queries evaluate as `not all`, leaving the src-less img
    // with no candidate.
    expect(() =>
      validateImportedContent(
        '<picture><source media="(" srcset="https://cdn.example.com/a.webp"><img alt=""></picture>'
      )
    ).toThrow('must use HTTPS URLs');
  });

  it('ignores a picture source with an impossible media range', () => {
    // No viewport is narrower than -1px, so the source never matches
    // and the src-less img renders nothing.
    expect(() =>
      validateImportedContent(
        '<picture><source media="(max-width: -1px)" srcset="https://cdn.example.com/a.webp"><img alt=""></picture>'
      )
    ).toThrow('must use HTTPS URLs');
  });

  it('ignores a picture source with an impossible mixed-unit range', () => {
    // 1in is 96px, so no viewport satisfies both bounds and the
    // src-less img renders nothing.
    expect(() =>
      validateImportedContent(
        '<picture><source media="(1in <= width <= 10px)" srcset="https://cdn.example.com/a.webp"><img alt=""></picture>'
      )
    ).toThrow('must use HTTPS URLs');
  });

  it('accepts a device-dependent media query with an img fallback', () => {
    // Viewport-dependent queries cannot be evaluated without a
    // device, so they stay applicable; the img fallback supplies a
    // candidate either way.
    expect(
      validateImportedContent(
        '<picture><source media="(min-width: 800px)" srcset="https://cdn.example.com/a.webp"><img src="https://cdn.example.com/a.png" alt="A"></picture>'
      )
    ).toContain('<img');
  });

  it('ignores a picture source placed after the img', () => {
    // Only preceding source siblings participate in selecting the
    // resource for the img, so this source cannot supply the src-less
    // image and the group stays broken.
    expect(() =>
      validateImportedContent(
        '<picture><img alt="A"><source srcset="https://cdn.example.com/a.webp"></picture><p>Body</p>'
      )
    ).toThrow('must use HTTPS URLs');
  });

  it('rejects a picture whose img is nested below a non-picture element', () => {
    // The source binds as a direct child, but the browser does not
    // associate it with the div-wrapped img, so the src-less img
    // renders nothing and the article must be rejected.
    expect(() =>
      validateImportedContent(
        '<picture><source srcset="https://cdn.example.com/a.webp"><div><img alt=""></div></picture>'
      )
    ).toThrow('must use HTTPS URLs');
  });

  it('accepts a nested picture img that carries its own fallback', () => {
    // Not picture-associated, but the img still renders its own src.
    expect(
      validateImportedContent(
        '<picture><source srcset="https://cdn.example.com/a.webp"><div><img src="https://cdn.example.com/a.png" alt="A"></div></picture>'
      )
    ).toContain('a.png');
  });

  it('ignores a picture source nested below a non-picture element', () => {
    expect(() =>
      validateImportedContent(
        '<picture><div><source srcset="https://cdn.example.com/a.webp"></div><img alt=""></picture>'
      )
    ).toThrow('must use HTTPS URLs');
  });

  it('ignores an orphan source element outside any picture', () => {
    // A source contributes candidates only inside picture; outside it
    // renders nothing, so its URL must not reject the handoff.
    expect(
      validateImportedContent(
        '<source srcset="http://example.com/old.webp"><p>Body</p>'
      )
    ).toContain('Body');
  });

  it('accepts a picture source followed by an unmatched end tag', () => {
    // Browsers ignore the stray `</div>` and sanitization normalizes
    // the markup, so the source still supplies the direct-child img.
    expect(
      validateImportedContent(
        '<picture><source srcset="https://cdn.example.com/a.webp"></div><img alt=""></picture>'
      )
    ).toContain('<img');
  });
});

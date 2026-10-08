import { describe, expect, it } from 'vitest';
import { validateImportedContent } from './review-handoff-content';

describe('validateImportedContent picture', () => {
  it('rejects a src-less img even when its picture source applies', () => {
    // The editor parses `img[src]` and drops src-less images, so the
    // import requires an `src` fallback even though the browser could
    // use the picture source; otherwise the reviewer opens a blank
    // editor and the next save loses the article's only image.
    expect(() =>
      validateImportedContent(
        '<picture><source srcset="https://cdn.example.com/a.webp"><img alt="A"></picture>'
      )
    ).toThrow('must use HTTPS URLs');
  });

  it('ignores a picture source with an inapplicable type', () => {
    // Browsers skip sources with unsupported types, so the skipped
    // source contributes no candidate and the img fallback carries
    // the group even though the srcset URL itself is unusable.
    expect(
      validateImportedContent(
        '<picture><source type="text/plain" srcset="http://example.com/old.webp"><img src="https://cdn.example.com/a.png" alt="A"></picture>'
      )
    ).toContain('a.png');
  });

  it('ignores a picture source with an unsupported image subtype', () => {
    // image/* alone is not enough: browsers skip MIME types they do
    // not support, so an unknown subtype contributes no candidate.
    expect(
      validateImportedContent(
        '<picture><source type="image/x-unknown" srcset="http://example.com/old.webp"><img src="https://cdn.example.com/a.png" alt=""></picture>'
      )
    ).toContain('a.png');
  });

  it('rejects a picture source with an applicable image type and bad URL', () => {
    // An applicable source contributes its candidates, so an
    // unusable srcset URL rejects the handoff despite the img src.
    expect(() =>
      validateImportedContent(
        '<picture><source type="image/webp" srcset="http://example.com/old.webp"><img src="https://cdn.example.com/a.png" alt="A"></picture>'
      )
    ).toThrow('must use HTTPS URLs');
  });

  it('treats an APNG picture source as applicable', () => {
    // Browsers select image/apng (the app advertises it in its Accept
    // header), so a broken APNG candidate rejects like any applicable
    // source instead of being ignored.
    expect(() =>
      validateImportedContent(
        '<picture><source type="image/apng" srcset="http://example.com/old.apng"><img src="https://cdn.example.com/a.png" alt="A"></picture>'
      )
    ).toThrow('must use HTTPS URLs');
  });

  it('ignores a picture source with an always-false media query', () => {
    // Browsers never match `not all`, so the skipped source
    // contributes no candidate and the img fallback carries the group.
    expect(
      validateImportedContent(
        '<picture><source media="not all" srcset="http://example.com/old.webp"><img src="https://cdn.example.com/a.png" alt=""></picture>'
      )
    ).toContain('a.png');
  });

  it('ignores a picture source with a syntactically invalid media query', () => {
    // Invalid queries evaluate as `not all`, contributing nothing.
    expect(
      validateImportedContent(
        '<picture><source media="(" srcset="http://example.com/old.webp"><img src="https://cdn.example.com/a.png" alt=""></picture>'
      )
    ).toContain('a.png');
  });

  it('ignores a picture source with an impossible media range', () => {
    // No viewport is narrower than -1px, so the source never matches
    // and contributes no candidate.
    expect(
      validateImportedContent(
        '<picture><source media="(max-width: -1px)" srcset="http://example.com/old.webp"><img src="https://cdn.example.com/a.png" alt=""></picture>'
      )
    ).toContain('a.png');
  });

  it('rejects a source whose media-type not negates an impossible range', () => {
    // The leading `not` negates the whole `all and (...)` query, so
    // the impossible width condition makes the source applicable and
    // its unusable URL rejects the handoff despite the img src.
    expect(() =>
      validateImportedContent(
        '<picture><source media="not all and (max-width: -1px)" srcset="http://example.com/old.webp"><img src="https://cdn.example.com/a.png" alt=""></picture>'
      )
    ).toThrow('must use HTTPS URLs');
  });

  it('ignores a picture source whose media ends in an unclosed comment', () => {
    // CSS consumes an unclosed comment through EOF, so the browser
    // evaluates the remaining `not all` and skips the source.
    expect(
      validateImportedContent(
        '<picture><source media="not all/*" srcset="http://example.com/old.webp"><img src="https://cdn.example.com/a.png" alt=""></picture>'
      )
    ).toContain('a.png');
  });

  it('ignores a picture source with an impossible mixed-unit range', () => {
    // 1in is 96px, so no viewport satisfies both bounds and the
    // source contributes no candidate.
    expect(
      validateImportedContent(
        '<picture><source media="(1in <= width <= 10px)" srcset="http://example.com/old.webp"><img src="https://cdn.example.com/a.png" alt=""></picture>'
      )
    ).toContain('a.png');
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
    // resource for the img, so a post-img source contributes no
    // candidate and the img src carries the group.
    expect(
      validateImportedContent(
        '<picture><img src="https://cdn.example.com/a.png" alt="A"><source srcset="http://example.com/old.webp"></picture><p>Body</p>'
      )
    ).toContain('Body');
  });

  it('rejects a picture whose img is nested below a non-picture element', () => {
    // A src-less img breaks the handoff wherever it sits: the editor
    // drops it on mount even inside a picture with usable sources.
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
    // A non-direct-child source never binds to the picture, so its
    // unusable URL cannot reject the handoff.
    expect(
      validateImportedContent(
        '<picture><div><source srcset="http://example.com/old.webp"></div><img src="https://cdn.example.com/a.png" alt=""></picture>'
      )
    ).toContain('a.png');
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
    // the markup; picture ancestry precision is pinned at the matcher
    // unit level while the valid group passes here.
    expect(
      validateImportedContent(
        '<picture><source srcset="https://cdn.example.com/a.webp"></div><img src="https://cdn.example.com/a.png" alt=""></picture>'
      )
    ).toContain('<img');
  });

  it('accepts a responsive picture with a usable source and img src', () => {
    // The happy path under the editor contract: an applicable source
    // plus the required src fallback passes on both layers.
    expect(
      validateImportedContent(
        '<picture><source media="(min-width: 800px)" srcset="https://cdn.example.com/a.webp"><img src="https://cdn.example.com/a.png" alt="A"></picture>'
      )
    ).toContain('a.png');
  });
});

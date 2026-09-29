import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'inter-naira-font.css'),
  'utf8'
);

describe('inter-naira-font.css', () => {
  it('declares the unicode-range naira face without putting it on first-paint CSS', () => {
    expect(css).toContain('font-family: "Inter Naira"');
    expect(css).toMatch(/--font-naira:\s*"Inter Naira"\s*;/);
    expect(css).not.toMatch(/--font-naira:[^;]*Inter Fallback/);
    expect(css).toContain('unicode-range: U+20A6');
    expect(css).toContain('.font-naira');
  });

  it('references the font under a content-hashed URL', () => {
    // The filename carries the first 12 hex of the woff2 sha256 so a byte
    // change ships under a new URL instead of fighting year-long
    // edge/browser caches. The old unhashed URL served "Store Not Found"
    // HTML with a one-year max-age; nothing may reference it again.
    expect(css).not.toContain('url("/fonts/inter-naira.woff2")');
    expect(css).toMatch(/url\("\/fonts\/inter-naira\.[0-9a-f]{12}\.woff2"\)/);
  });

  it('ships the referenced woff2 from the deployed public directory', () => {
    // Production serves static files from the repo-root public/ directory,
    // not apps/web/public/. A font present only under apps/web 404s through
    // to the [slug] router and comes back as "Store Not Found" HTML, which
    // Chrome then fails to decode as a font on every priced page.
    const match = css.match(
      /url\("(\/fonts\/(inter-naira\.([0-9a-f]{12})\.woff2))"\)/
    );
    expect(match).not.toBeNull();
    const [, , filename, suffix] = match as RegExpMatchArray;
    const repoRoot = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      '..'
    );
    const deployed = join(repoRoot, 'public', 'fonts', basename(filename));
    expect(existsSync(deployed)).toBe(true);
    const bytes = readFileSync(deployed);
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('wOF2');
    // The hash suffix must match the bytes, or an edit silently ships
    // fresh bytes under a poisoned URL (or stale bytes under a fresh one).
    const actual = createHash('sha256')
      .update(bytes)
      .digest('hex')
      .slice(0, 12);
    expect(actual).toBe(suffix);
    // The apps/web copy serves local dev; the deployed copy must be the
    // same bytes or dev and prod render different glyphs.
    expect(
      bytes.equals(
        readFileSync(
          join(repoRoot, 'apps', 'web', 'public', 'fonts', basename(filename))
        )
      )
    ).toBe(true);
  });
});

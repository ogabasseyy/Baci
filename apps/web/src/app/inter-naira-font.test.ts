import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
    expect(css).toContain('url("/fonts/inter-naira.woff2")');
    expect(css).toContain('unicode-range: U+20A6');
    expect(css).toContain('.font-naira');
  });

  it('ships the referenced woff2 from the deployed public directory', () => {
    // Production serves static files from the repo-root public/ directory,
    // not apps/web/public/. A font present only under apps/web 404s through
    // to the [slug] router and comes back as "Store Not Found" HTML, which
    // Chrome then fails to decode as a font on every priced page.
    const repoRoot = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      '..'
    );
    const deployed = join(repoRoot, 'public', 'fonts', 'inter-naira.woff2');
    expect(existsSync(deployed)).toBe(true);
    const bytes = readFileSync(deployed);
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('wOF2');
    // The apps/web copy serves local dev; the deployed copy must be the
    // same bytes or dev and prod render different glyphs.
    expect(
      bytes.equals(
        readFileSync(
          join(repoRoot, 'apps', 'web', 'public', 'fonts', 'inter-naira.woff2')
        )
      )
    ).toBe(true);
  });
});

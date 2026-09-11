import { readFileSync } from 'node:fs';
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
});

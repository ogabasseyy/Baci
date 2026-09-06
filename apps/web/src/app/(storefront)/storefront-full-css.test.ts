// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/postcss';
import postcss from 'postcss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const directory = dirname(fileURLToPath(import.meta.url));
const unrelatedZIndex = 987654;
// Assertions must not provide utility candidates to this scanned test file.
const expectedSelectors = [
  ['bg', 'primary'],
  ['grid', 'cols', '2'],
  ['sr', 'only'],
].map((parts) => `.${parts.join('-')}`);
let temporaryRoot: string;
let css: string;

describe('storefront full stylesheet source boundary', () => {
  beforeAll(async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'storefront-css-source-'));
    // Simulate unrelated app/tooling code inside Tailwind's automatic scan root.
    // Construct the class so this colocated test is not itself its source.
    await writeFile(
      join(temporaryRoot, 'unrelated-page.tsx'),
      `<div className="z-[${unrelatedZIndex}]" />`
    );
    const from = join(directory, 'storefront-full.css');
    const result = await postcss([
      tailwind({ base: temporaryRoot, optimize: true }),
    ]).process(await readFile(from, 'utf8'), { from, map: false });
    css = result.css;
  }, 20_000);

  afterAll(async () => {
    if (temporaryRoot)
      await rm(temporaryRoot, { recursive: true, force: true });
  });

  it('does not generate utilities from unrelated automatically detected app code', () => {
    expect(css.includes(`z-index:${unrelatedZIndex}`)).toBe(false);
  });

  it('excludes the utility owned only by the in-repository dashboard preview', () => {
    expect(css.includes(`.${['border', '14'].join('-')}`)).toBe(false);
  });

  it('still generates shared UI and storefront utilities from explicit sources', () => {
    for (const selector of expectedSelectors) {
      expect(css.includes(selector), selector).toBe(true);
    }
  });

  it('does not seed the expected utilities when only this test is scanned', async () => {
    const result = await postcss([
      tailwind({ base: temporaryRoot, optimize: true }),
    ]).process(
      '@import "tailwindcss" source(none);\n' +
        '@theme { --color-primary: #123456; }\n' +
        '@source "./storefront-full-css.test.ts";',
      { from: join(directory, 'assertion-sources.css'), map: false }
    );
    // A literal candidate proves that this file was actually scanned.
    expect(result.css.includes('.flex{display:flex}')).toBe(true);
    for (const selector of expectedSelectors) {
      expect(result.css.includes(selector), selector).toBe(false);
    }
  });

  it('consumes the source boundary at build time instead of emitting an invalid media query', () => {
    expect(css).not.toContain('source(none)');
    expect(css).not.toContain('@source');
  });
});

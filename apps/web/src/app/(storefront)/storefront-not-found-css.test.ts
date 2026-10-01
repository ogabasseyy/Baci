// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/postcss';
import postcss from 'postcss';
import { expect, it } from 'vitest';

it('keeps the shared 404 boundary styled without the full storefront bundle', async () => {
  const from = fileURLToPath(
    new URL('./storefront-not-found.css', import.meta.url)
  );
  const result = await postcss([tailwind({ optimize: true })]).process(
    await readFile(from, 'utf8'),
    { from, map: false }
  );
  expect(result.css.length).toBeLessThan(50_000);
  for (const parts of [
    ['text', '8xl'],
    ['rounded', '3xl'],
    ['inline', 'flex'],
  ]) {
    expect(result.css).toContain(`.${parts.join('-')}`);
  }
  expect(result.css).not.toContain(`.${['border', '14'].join('-')}`);
  const boundary = await readFile(
    new URL('./[slug]/not-found.tsx', import.meta.url),
    'utf8'
  );
  expect(boundary).not.toContain('storefront-eager-full-css-layout');
});

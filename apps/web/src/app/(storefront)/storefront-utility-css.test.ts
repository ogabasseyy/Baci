// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/postcss';
import postcss from 'postcss';
import { expect, it } from 'vitest';

it('ships utility layout styles without scanning dashboard sources', async () => {
  const from = fileURLToPath(
    new URL('./storefront-utility.css', import.meta.url)
  );
  const result = await postcss([tailwind({ optimize: true })]).process(
    await readFile(from, 'utf8'),
    { from, map: false }
  );
  expect(result.css.length).toBeLessThan(200_000);
  for (const parts of [
    ['min-h', 'screen'],
    ['items', 'center'],
    ['flex', 'col'],
  ]) {
    expect(result.css).toContain(`.${parts.join('-')}`);
  }
  expect(result.css).not.toContain(`.${['border', '14'].join('-')}`);
  const home = await readFile(
    new URL('./storefront-home.css', import.meta.url),
    'utf8'
  );
  expect(home).not.toContain('storefront-utility.css');
});

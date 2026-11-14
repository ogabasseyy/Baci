// @vitest-environment node
import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/postcss';
import postcss from 'postcss';
import { expect, it } from 'vitest';

it('generates readable brand button utilities for scoped storefront stylesheets', async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const result = await postcss([tailwind({ base: root })]).process(
    '@import "tailwindcss" source(none); @config "./tailwind.storefront.scoped.config.mjs"; @source inline("bg-store-primary text-store-primary-text");',
    { from: `${root}theme-regression.css` }
  );
  expect(result.css).toContain('.bg-store-primary');
  expect(result.css).toContain('background-color: var(--store-primary');
  expect(result.css).toContain('.text-store-primary-text');
  expect(result.css).toContain('color: var(--store-primary-text');
});

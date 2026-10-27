// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/postcss';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

describe('storefront route-scoped listing, content, utility, and blog-post CSS', () => {
  it('compiles catalog listing styles under 120 KB without dashboard utilities', async () => {
    const from = fileURLToPath(
      new URL('./storefront-listing.css', import.meta.url)
    );
    const result = await postcss([tailwind({ optimize: true })]).process(
      await readFile(from, 'utf8'),
      { from, map: false }
    );
    expect(result.css.length).toBeLessThan(120_000);
    for (const parts of [
      ['grid', 'cols', '2'],
      ['items', 'center'],
      ['flex', 'col'],
    ]) {
      expect(result.css).toContain(`.${parts.join('-')}`);
    }
    expect(result.css).toContain('.min-h-\\[1100px\\]');
    expect(result.css).toContain('.bg-store-primary');
    expect(result.css).toContain('.aspect-square');
    expect(result.css).toContain('.line-clamp-2');
    // Route-unique: only CategoryFiltersSidebar (in this sheet's sources)
    // uses slide-in-from-top-1, so a dropped sidebar @source fails here.
    expect(result.css).toContain('.slide-in-from-top-1');
    expect(result.css).not.toContain(`.${['border', '14'].join('-')}`);
  }, 20_000);

  it('compiles public content styles under 140 KB without dashboard utilities', async () => {
    const from = fileURLToPath(
      new URL('./storefront-content.css', import.meta.url)
    );
    const result = await postcss([tailwind({ optimize: true })]).process(
      await readFile(from, 'utf8'),
      { from, map: false }
    );
    expect(result.css.length).toBeLessThan(140_000);
    for (const parts of [
      ['min-h', 'screen'],
      ['items', 'center'],
      ['flex', 'col'],
    ]) {
      expect(result.css).toContain(`.${parts.join('-')}`);
    }
    expect(result.css).toContain('.min-h-\\[1100px\\]');
    expect(result.css).toContain('.bg-store-primary');
    expect(result.css).toContain('.rounded-3xl');
    expect(result.css).toContain('.leading-7');
    // Route-unique: only trust-policy-page-client (in this sheet's sources)
    // uses tracking-[0.28em], so a dropped trust @source fails here.
    expect(result.css).toContain('.tracking-\\[0\\.28em\\]');
    expect(result.css).not.toContain(`.${['border', '14'].join('-')}`);
  }, 20_000);

  it('compiles utility route styles under 200 KB without dashboard utilities', async () => {
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
    expect(result.css).toContain('.min-h-\\[1100px\\]');
    expect(result.css).toContain('.bg-store-primary');
    // Route-unique: min-h-[100px] comes only from RepairDeviceStep and
    // min-h-[250px] only from the quiz ad fallback in this sheet's sources.
    expect(result.css).toContain('.min-h-\\[100px\\]');
    expect(result.css).toContain('.min-h-\\[250px\\]');
    expect(result.css).toContain('.space-y-6');
    expect(result.css).not.toContain(`.${['border', '14'].join('-')}`);
  }, 20_000);

  it('compiles additive blog post styles under 60 KB without re-emitting foundation rules', async () => {
    const from = fileURLToPath(
      new URL('./storefront-blog-post.css', import.meta.url)
    );
    const result = await postcss([tailwind({ optimize: true })]).process(
      await readFile(from, 'utf8'),
      { from, map: false }
    );
    expect(result.css.length).toBeLessThan(60_000);
    expect(result.css).toContain('.bg-store-primary');
    expect(result.css).toContain('.prose');
    expect(result.css).toContain('.font-mono');
    expect(result.css).toContain('.max-w-none');
    // The additive sheet must not emit Card utilities itself: the blog
    // listing sheet (loaded first) owns Badge/Card. See the combined-order
    // test in storefront-blog-css.test.ts.
    expect(result.css).not.toContain('.bg-card');
    expect(result.css).not.toContain('--store-primary:');
    expect(result.css).not.toContain('--touch-target-min');
    expect(result.css).not.toContain('--dashboard-surface');
    expect(result.css).not.toContain('--viewport-height-dynamic');
    expect(result.css).not.toContain('skeleton-shimmer');
    expect(result.css).not.toContain(`.${['border', '14'].join('-')}`);
  }, 20_000);
});

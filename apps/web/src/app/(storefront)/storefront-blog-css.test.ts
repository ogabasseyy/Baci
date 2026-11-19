// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/postcss';
import postcss, { type Root } from 'postcss';
import { beforeAll, describe, expect, it } from 'vitest';

const directory = dirname(fileURLToPath(import.meta.url));
let compiled: Root;

describe('published blog typography', () => {
  beforeAll(async () => {
    const from = join(directory, 'storefront-blog.css');
    const result = await postcss([tailwind({ optimize: true })]).process(
      await readFile(from, 'utf8'),
      { from, map: false }
    );
    compiled = postcss.parse(result.css);
  }, 30_000);

  it('keeps underlined article links on the readable foreground token', () => {
    const colors: string[] = [];
    compiled.walkRules((rule) => {
      if (rule.selector === '.prose-baci a') {
        rule.walkDecls('color', (decl) => {
          colors.push(decl.value);
        });
      }
    });
    expect(colors).toContain('hsl(var(--foreground))');
  });

  it.each([
    'body',
    'headings',
    'bold',
    'quotes',
    'captions',
    'links',
  ])('binds %s to resolved theme tokens without requiring a dark class', (part) => {
    const values: string[] = [];
    compiled.walkRules((rule) => {
      if (rule.selector === '.prose-baci') {
        rule.walkDecls(`--tw-prose-${part}`, (decl) => {
          values.push(decl.value);
        });
      }
    });
    expect(values.some((value) => value.includes('var(--'))).toBe(true);
  });
});

describe('blog sheets compiled in layout order', () => {
  it('emits Badge/Card utilities exactly once across blog + blog-post', async () => {
    const compile = async (name: string) => {
      const from = join(directory, name);
      const result = await postcss([tailwind({ optimize: true })]).process(
        await readFile(from, 'utf8'),
        { from, map: false }
      );
      return result.css;
    };
    // Layout order: [postSlug]/layout.tsx imports blog.css, then
    // blog-post.css. The delta sheet relies on the listing sheet for
    // Badge/Card utilities, so combined output must carry them once.
    const combined = postcss.parse(
      (await compile('storefront-blog.css')) +
        (await compile('storefront-blog-post.css'))
    );
    for (const selector of [
      '.bg-card',
      '.text-card-foreground',
      '.ring-offset-background',
      // Renderer-only utilities from the delta sheet (blog-code-block).
      '.bg-slate-950',
      '.text-slate-50',
    ]) {
      let count = 0;
      combined.walkRules((rule) => {
        if (rule.selector === selector) {
          count += 1;
        }
      });
      expect(count).toBe(1);
    }
  }, 30_000);
});

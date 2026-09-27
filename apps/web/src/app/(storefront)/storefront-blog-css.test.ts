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

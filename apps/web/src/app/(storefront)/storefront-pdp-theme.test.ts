// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/postcss';
import postcss from 'postcss';
import { expect, it } from 'vitest';

it('emits branded purchase controls and extracted product typography in the standalone PDP sheet', async () => {
  const from = fileURLToPath(new URL('./storefront-pdp.css', import.meta.url));
  const { css } = await postcss([tailwind({ optimize: true })]).process(
    await readFile(from, 'utf8'),
    { from, map: false }
  );
  const declarations = (selector: string) => {
    const values: string[] = [];
    postcss.parse(css).walkRules((rule) => {
      if (!rule.selectors.includes(selector)) return;
      rule.walkDecls((decl) => {
        values.push(`${decl.prop}:${decl.value}`);
      });
    });
    return values.join(';');
  };
  expect(declarations('.bg-store-primary')).toContain(
    'background-color:var(--store-primary'
  );
  expect(declarations('.text-store-primary-text')).toContain(
    'color:var(--store-primary-text'
  );
  expect(css).toContain(
    'body:has(.ogabassey-mobile-footer:not(.ogabassey-mobile-footer--hidden))'
  );
  expect(css).toContain('visibility:hidden');
  expect(css).toContain(
    'body:has([data-sticky-cart-visible=true]):has(.ogabassey-mobile-footer--hidden) .ogabassey-chat-anchor:not(:has(.ogabassey-chat-button--open))'
  );
  expect(
    declarations(
      'body:has([data-sticky-cart-visible=true]):has(.ogabassey-mobile-footer--hidden) .ogabassey-chat-anchor:not(:has(.ogabassey-chat-button--open))'
    )
  ).toContain('bottom:calc(env(safe-area-inset-bottom,0px) + 9rem)');
  expect(css).toContain('pointer-events:none');
  expect(declarations('.text-3xl')).toContain('font-size:');
  expect(declarations('.bg-store-background')).toContain(
    'background-color:var(--store-background'
  );
});

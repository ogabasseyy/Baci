// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/postcss';
import postcss from 'postcss';
import { expect, it } from 'vitest';

it('keeps cart styles in the persistent storefront route layout', async () => {
  const routeLayout = readFileSync(
    new URL('./[slug]/layout.tsx', import.meta.url),
    'utf8'
  );
  expect(routeLayout).toContain(
    "import '@/app/(storefront)/storefront-cart-drawer.css'"
  );
  const drawer = readFileSync(
    new URL(
      '../../components/storefront/ogabassey/components/CartSidebar.tsx',
      import.meta.url
    ),
    'utf8'
  );
  expect(drawer).toContain('fixed inset-0 z-80 overflow-hidden');

  const stylesheet = fileURLToPath(
    new URL('./storefront-cart-drawer.css', import.meta.url)
  );
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const result = await postcss([tailwind({ base: root })]).process(
    readFileSync(stylesheet, 'utf8'),
    { from: stylesheet }
  );
  const css = postcss.parse(result.css);
  expect(result.css).toContain('--theme-radius-xl: calc(var(--radius) + 4px)');
  for (const selector of [
    '.bg-red-600',
    '.rounded-xl',
    '.py-3\\.5',
    '.shadow-lg',
    '.z-80',
  ]) {
    const rules: string[] = [];
    css.walkRules(selector, (rule) => {
      rules.push(rule.toString());
    });
    expect(rules.join('\n'), selector).not.toBe('');
  }
});

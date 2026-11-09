import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('uses storefront foreground and background tokens for the payment plan', () => {
  const css = readFileSync(
    'src/components/payments/oxygen/OxygenPlanForm.module.css',
    'utf8'
  );
  expect(css).toContain('var(--store-background-text');
  expect(css).toContain('var(--store-background,');
  expect(css).toMatch(/\.form\s*\{[^}]*color:\s*var\(--store-background-text/s);
  expect(css).toMatch(/\.card\s*\{[^}]*background:\s*var\(--store-background/s);
});

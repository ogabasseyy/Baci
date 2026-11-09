import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('uses storefront foreground and background tokens for the payment plan', () => {
  const relative = 'src/components/payments/oxygen/OxygenPlanForm.module.css';
  const css = readFileSync(
    resolve(existsSync(relative) ? relative : `apps/web/${relative}`),
    'utf8'
  );
  expect(css).toContain('var(--store-background-text');
  expect(css).toContain('var(--store-background,');
  expect(css).toMatch(/\.form\s*\{[^}]*color:\s*var\(--store-background-text/s);
  expect(css).toMatch(/\.card\s*\{[^}]*background:\s*var\(--store-background/s);
});

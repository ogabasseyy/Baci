import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('uses the same storefront surface and foreground for the payment breakdown', () => {
  const relative =
    'src/components/payments/oxygen/OxygenComparisonSummary.module.css';
  const css = readFileSync(
    resolve(existsSync(relative) ? relative : `apps/web/${relative}`),
    'utf8'
  );
  const summary = css.match(/\.summary\s*\{([^}]*)\}/)?.[1] ?? '';
  expect(summary).toContain('var(--store-background');
  expect(summary).toContain('var(--store-background-text');
  expect(css).not.toMatch(/background:\s*(white|#fff(?:fff)?)(?:\s|;)/i);
});

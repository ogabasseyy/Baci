import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { expect, it } from 'vitest';

it('uses storefront foreground and background tokens for the payment plan', () => {
  const css = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      'OxygenPlanForm.module.css'
    ),
    'utf8'
  );
  const root = postcss.parse(css);
  const effective = (selector: string, property: string) => {
    let value = '';
    root.walkRules(selector, (rule) => {
      rule.walkDecls(property, (decl) => {
        value = decl.value;
      });
    });
    return value;
  };
  expect(effective('.form', 'color')).toContain('var(--store-background-text');
  expect(effective('.card', 'background')).toContain('var(--store-background');
});

it('uses the readable storefront foreground for editing the down payment', () => {
  const css = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      'OxygenDownPaymentAmount.module.css'
    ),
    'utf8'
  );
  let color = '';
  postcss.parse(css).walkRules('.editAmount', (rule) => {
    rule.walkDecls('color', (decl) => {
      color = decl.value;
    });
  });
  expect(color).toContain('var(--store-background-text');
});

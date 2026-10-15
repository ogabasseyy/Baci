import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';

test('migration-only recovery changes cannot skip the PostgreSQL quality gate', () => {
  const filters = parse(readFileSync(new URL('../filters/ci.yml', import.meta.url), 'utf8'));
  for (const path of [
    'supabase/migrations/*customer_checkout_shipping_recovery*',
    'supabase/tests/*recovery*',
    'supabase/tests/extract-sql-function-definition*',
    'supabase/tests/shipping-quote-proof-postgres-test-harness.mjs',
    '.github/scripts/shipping-recovery-ci-contract.test.mjs',
  ]) assert.ok(filters.web.includes(path), `missing web gate pattern ${path}`);
});

test('the quality gate enables real recovery PostgreSQL tests before test-plan shortcuts', () => {
  const workflow = parse(readFileSync(new URL('../workflows/ci.yml', import.meta.url), 'utf8'));
  const steps = workflow.jobs['quality-test'].steps;
  const index = steps.findIndex((step) => step.name === 'Verify authenticated shipping recovery in PostgreSQL');
  assert.ok(index >= 0, 'missing real PostgreSQL recovery step');
  const step = steps[index];
  assert.equal(step.env.BACI_SHIPPING_QUOTE_POSTGRES, '1');
  assert.equal(step.if, undefined, 'the actor permission suite must not depend on test-plan shortcuts');
  assert.ok(index < steps.findIndex((candidate) => candidate.name === 'Run Tests'));
  for (const suite of [
    'customer-checkout-shipping-recovery-acl.postgres.test.ts',
    'customer-checkout-shipping-recovery.postgres.test.ts',
    'customer-checkout-shipping-recovery-concurrency.postgres.test.ts',
    'prepare-checkout-shipping-recovery.postgres.test.ts',
    'customer-checkout-shipping-recovery-quantity.postgres.test.ts',
    'customer-checkout-shipping-recovery-aliases.postgres.test.ts',
  ]) assert.ok(step.run.includes(`src/lib/shipping/${suite}`), `missing ${suite}`);
  assert.ok(step.run.includes('extract-sql-function-definition.test.mjs'));
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import YAML from 'yaml';

const read = path => YAML.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const deploy = read('../workflows/deploy.yml');
const ci = read('../workflows/ci.yml');

test('the address grant follows the existing scope gates and observed guard reload', () => {
  const steps = deploy.jobs['db-migrations'].steps;
  const previous = steps.findIndex(step => step.run?.includes('probe-cart-quota-hook-reload.sh'));
  const guard = steps.findIndex(step => String(step.env?.MIGRATION_MAX_VERSION) === '20261030075538');
  const probe = steps.findIndex(step => step.run?.includes('probe-address-budget-hook-reload.sh'));
  const remaining = steps.findIndex(step => step.name === 'Apply remaining pending migrations via Management API');
  assert.ok(previous >= 0 && guard > previous && probe > guard && remaining > probe);
  assert.equal(steps[probe].env.ADDRESS_BUDGET_HOOK_PROBE_ALLOW_UNBOUND_URL, undefined);
  assert.ok(read('../filters/deploy.yml').tracking.includes('supabase/migrations/*gigl*'));
});

test('database replay and signed API confinement remain required CI checks', () => {
  assert.ok(ci.jobs['quality-db-replay'].steps.some(step => step.run?.includes('--sql-check supabase/tests/address_provider_budget.sql')));
  const steps = ci.jobs['quality-misc'].steps;
  const signed = steps.find(step => step.run?.includes('node --test .github/scripts/address-provider-budget-postgrest.test.mjs'));
  assert.equal(signed?.if, "needs.changes.outputs.deploy_scripts == 'true'");
  assert.match(signed.run, /sha256sum -c/);
  assert.match(signed.run, /node --test .github\/scripts\/address-provider-budget\.sql\.test\.mjs/);
  assert.ok(steps.some(step => step.run?.includes('.github/scripts/probe-address-budget-hook-reload-binding.test.mjs')));
  const patterns = read('../filters/ci.yml').deploy_scripts;
  for (const path of ['.github/scripts/address-provider-budget*.mjs', '.github/scripts/probe-address-budget-hook-reload*',
    'apps/web/src/lib/address-budget/**', 'apps/web/src/schemas/address-budget-*.ts', 'apps/web/src/app/api/places/**',
    'supabase/migrations/*address_provider_budget*', 'supabase/tests/address_provider_budget*']) assert.ok(patterns.includes(path), path);
});

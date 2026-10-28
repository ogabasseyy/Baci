import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import YAML from 'yaml';

const deploy = YAML.parse(
  readFileSync(new URL('../workflows/deploy.yml', import.meta.url), 'utf8')
);
const ci = YAML.parse(
  readFileSync(new URL('../workflows/ci.yml', import.meta.url), 'utf8')
);
const deployFilters = YAML.parse(
  readFileSync(new URL('../filters/deploy.yml', import.meta.url), 'utf8')
);

test('quota guard reload is witnessed before the membership migration can run', () => {
  const steps = deploy.jobs['db-migrations'].steps;
  const guestProbe = steps.findIndex((step) =>
    step.run?.includes('probe-guest-cart-hook-reload.sh')
  );
  const scope = steps.findIndex(
    (step) => String(step.env?.MIGRATION_MAX_VERSION) === '20261027051250'
  );
  const probe = steps.findIndex((step) =>
    step.run?.includes('probe-cart-quota-hook-reload.sh')
  );
  const remaining = steps.findIndex(
    (step) => step.name === 'Apply remaining pending migrations via Management API'
  );
  assert.ok(guestProbe >= 0 && scope > guestProbe, 'quota scope follows guest-cart probe');
  assert.ok(probe > scope, 'quota probe follows capped scope apply');
  assert.ok(remaining > probe, 'membership grant remains behind quota probe');
  const maintenance = steps.findIndex((step) =>
    step.run?.includes('verify-cart-quota-maintenance.sh')
  );
  assert.ok(maintenance > remaining, 'cleanup success gates deployment after grant');
  assert.ok(
    deploy.jobs['db-migrations']['timeout-minutes'] >= 80,
    'migration job allows time for reload probes and cleanup'
  );
});

test('database replay runs the cart quota RLS and worker-scope assertions', () => {
  const steps = ci.jobs['quality-db-replay'].steps;
  assert.ok(
    steps.some((step) =>
      step.run?.includes('--sql-check supabase/tests/commerce_cart_quota.sql')
    ),
    'the replay must execute the cart quota SQL suite'
  );
});

test('quota guard migration triggers the GIGL tracking deployment checks', () => {
  const migrations = readdirSync(
    new URL('../../supabase/migrations/', import.meta.url)
  );
  const guards = migrations.filter((name) =>
    name.startsWith('20261027051250_')
  );
  assert.equal(guards.length, 1, 'the quota guard migration is unique');
  assert.match(guards[0], /gigl/, 'the guard must match the tracking glob');
  assert.ok(
    deployFilters.tracking.includes('supabase/migrations/*gigl*'),
    'GIGL migrations must trigger tracking checks'
  );
});

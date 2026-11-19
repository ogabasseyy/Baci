import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { baseEnv, runProbe, startStub } from './probe-cart-quota-hook-reload-harness.mjs';

const script = fileURLToPath(new URL('./verify-cart-quota-maintenance.sh', import.meta.url));

async function check(mgmt, overrides = {}) {
  const stub = await startStub({ mgmt, canary: () => [404, {}] });
  try {
    return await runProbe(baseEnv(stub.port, {
      CART_QUOTA_CRON_DEADLINE_S: '1',
      CART_QUOTA_CRON_INTERVAL_S: '0',
      ...overrides,
    }), script);
  } finally {
    stub.server.close();
  }
}

test('accepts the active cleanup job after a recent successful run', async () => {
  const result = await check((body) =>
    body.query.includes('pg_extension')
      ? [200, [{ installed: true }]]
      : [200, [{ active: true, correct: true, succeeded: true }]]
  );
  assert.equal(result.status, 0, result.stderr);
});

test('reports the deployment and activation block if pg_cron is missing', async () => {
  const result = await check(() => [200, [{ installed: false }]]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /pg_cron/);
  assert.match(result.stderr, /production deployment and cart quota activation are blocked/);
});

test('blocks activation if the expected cleanup job is missing or inactive', async () => {
  const result = await check((body) =>
    body.query.includes('pg_extension')
      ? [200, [{ installed: true }]]
      : [200, [{ active: false, correct: true, succeeded: false }]]
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cleanup job/);
});

test('blocks activation when no cleanup run succeeds before the deadline', async () => {
  const result = await check((body) =>
    body.query.includes('pg_extension')
      ? [200, [{ installed: true }]]
      : [200, [{ active: true, correct: true, succeeded: false }]]
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /successful cleanup run/);
});

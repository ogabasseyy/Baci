import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import YAML from 'yaml';

import { RUN_WATCH_TIMEOUT_MS } from './release-production.mjs';

// Pins the deploy.yml job timeouts the run-watcher budget derives
// from: a workflow edit that lengthens the critical path must force
// a conscious budget review instead of silently shrinking the
// queue/approval slack and abandoning healthy slow releases.
const deploy = YAML.parse(readFileSync(new URL('../workflows/deploy.yml', import.meta.url), 'utf8'));

test('the run watcher covers the sequential workflow allowance plus slack', () => {
  const timeouts = {
    'vps-drain-readiness': 10,
    'db-migrations': 50,
    'gigl-worker-capability': 10,
    'deploy-production': 150,
  };
  let sequential = 0;
  for (const [job, minutes] of Object.entries(timeouts)) {
    assert.equal(deploy.jobs[job]['timeout-minutes'], minutes, `${job} timeout drifted; revisit RUN_WATCH_TIMEOUT_MS`);
    sequential += minutes;
  }
  assert.ok(
    RUN_WATCH_TIMEOUT_MS >= (sequential + 60) * 60 * 1000,
    'watcher budget must cover the 220-min sequential allowance plus queue/approval slack',
  );
});

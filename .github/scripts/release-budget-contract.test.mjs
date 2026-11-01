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
    'db-migrations': 80,
    'gigl-worker-capability': 10,
    'deploy-production': 240,
  };
  let sequential = 0;
  for (const [job, minutes] of Object.entries(timeouts)) {
    assert.equal(deploy.jobs[job]['timeout-minutes'], minutes, `${job} timeout drifted; revisit RUN_WATCH_TIMEOUT_MS`);
    sequential += minutes;
  }
  assert.ok(
    RUN_WATCH_TIMEOUT_MS >= (sequential + 60) * 60 * 1000,
    'watcher budget must cover the 340-min sequential allowance plus queue/approval slack',
  );
});

test('production budget leaves time to finish and publish after the measured slow build', () => {
  const job = deploy.jobs['deploy-production'];
  const publish = job.steps.find(
    (step) => step.name === 'Deploy to Vercel (with retry)',
  );

  // Run 40987693051 completed compilation and TypeScript, then reached
  // 3461/3521 static pages before its job budget cancelled progressing work.
  const observedPartialJobMinutes = Math.ceil(
    (Date.parse('2026-10-30T04:25:35Z') -
      Date.parse('2026-10-30T01:54:41Z')) /
      60_000,
  );
  const completionAndVerificationMinutes = 20;

  assert.equal(job['runs-on'], 'baci-deploy');
  assert.ok(Number.isInteger(job['timeout-minutes']));
  assert.equal(publish['timeout-minutes'], 55);
  assert.ok(
    job['timeout-minutes'] >=
      observedPartialJobMinutes +
        publish['timeout-minutes'] +
        completionAndVerificationMinutes,
    'The job must leave completion, publication and verification time after the observed progressing build',
  );
  assert.ok(
    job['timeout-minutes'] <= 240,
    'Keep the VPS job bounded to four hours',
  );
});

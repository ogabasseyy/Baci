import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('admin release allows a cold React Native source build and upload to complete', () => {
  const workflow = readFileSync(new URL('../workflows/android-release.yml', import.meta.url), 'utf8');
  const job = workflow.match(/  build-and-deploy:\n([\s\S]*?)(?=\n  [a-z][\w-]*:\n|$)/)?.[1];
  assert.ok(job, 'missing admin release job');
  const timeout = Number(job.match(/^    timeout-minutes: (\d+)$/m)?.[1]);
  assert.ok(timeout >= 600, `cold build needs a larger job budget; got ${timeout}`);
});

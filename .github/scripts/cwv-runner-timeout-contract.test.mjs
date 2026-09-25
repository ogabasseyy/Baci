import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import YAML from 'yaml';

test('keeps serial CWV contracts within a bounded cold-run budget', async () => {
  const workflow = YAML.parse(await readFile('.github/workflows/ci.yml', 'utf8'));
  const job = workflow.jobs['cwv-runner-contracts'];
  const testStep = job.steps.find(({ name }) => name === 'Run CWV runner contract tests');

  assert.equal(job['timeout-minutes'], 30);
  assert.match(testStep.run, /--test-concurrency=1/);
});

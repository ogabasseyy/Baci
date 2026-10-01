import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../workflows/preview.yml', import.meta.url),
  'utf8'
);

// Guard comments name the forbidden tokens; enforce against executable lines.
const executable = workflow
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

test('preview workflow stays dispatch-only', () => {
  assert.match(workflow, /^\s{2}workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s{2}push:/m);
  assert.doesNotMatch(workflow, /^\s{2}pull_request:/m);
  assert.doesNotMatch(workflow, /^\s{2}pull_request_target:/m);
});

test('preview workflow selects the target ref via inputs, not --ref execution', () => {
  assert.match(workflow, /required:\s*true/);
  assert.match(workflow, /ref:\s*\$\{\{\s*inputs\.ref\s*\}\}/);
  assert.doesNotMatch(workflow, /^\s*repository:/m);
});

test('preview workflow never promotes to production', () => {
  assert.doesNotMatch(executable, /--prod\b/);
  assert.doesNotMatch(executable, /environment:\s*production/);
  assert.doesNotMatch(executable, /name:\s*production/);
  assert.match(
    workflow,
    /pull\s+--yes\s+--environment=preview/
  );
});

test('preview deploy stays prebuilt with the required archive flag', () => {
  assert.match(
    workflow,
    /deploy\s+--yes\s+--prebuilt\s+--archive=tgz/
  );
});

test('preview workflow runs on github-hosted runners only', () => {
  assert.match(workflow, /runs-on:\s*ubuntu-24\.04/);
  assert.doesNotMatch(workflow, /self-hosted/);
  assert.doesNotMatch(workflow, /baci-deploy/);
  assert.doesNotMatch(workflow, /baci-vps/);
});

test('deployment secrets stay off the job-level environment', () => {
  const jobEnv = workflow.match(
    /\n {4}env:\n((?: {6}[^\n]*\n)+)/
  )?.[1];
  assert.ok(jobEnv, 'job env block must remain extractable');
  for (const secret of [
    'TURBO_TOKEN',
    'TURBO_TEAM',
    'VERCEL_ORG_ID',
    'VERCEL_PROJECT_ID',
    'VERCEL_TOKEN',
    'QUIZ_RPC_SERVER_SECRET',
  ]) {
    assert.doesNotMatch(
      jobEnv,
      new RegExp(`^ {6}${secret}:`, 'm'),
      `${secret} must be step-scoped, not job-scoped`
    );
  }
});

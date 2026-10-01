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
  const onBlock = executable.match(/\non:\n([\s\S]*?)\n[a-z]+:/)?.[1];
  assert.ok(onBlock, 'on: block must remain extractable');
  const triggers = [...onBlock.matchAll(/^ {2}([a-z_]+):/gm)].map(
    (match) => match[1]
  );
  assert.deepEqual(triggers, ['workflow_dispatch']);
});

test('preview workflow selects the target ref via inputs, not --ref execution', () => {
  assert.match(workflow, /required:\s*true/);
  assert.match(workflow, /ref:\s*\$\{\{\s*inputs\.ref\s*\}\}/);
  assert.doesNotMatch(workflow, /^\s*repository:/m);
});

test('preview workflow refuses branch-selected workflow files', () => {
  assert.match(executable, /github\.event\.repository\.default_branch/);
  assert.match(executable, /github\.ref/);
});

test('preview workflow never promotes to production', () => {
  assert.doesNotMatch(executable, /--prod\b/);
  assert.doesNotMatch(executable, /environment:\s*production/);
  assert.doesNotMatch(executable, /name:\s*production/);
  assert.match(executable, /pull\s+--yes\s+--environment=preview/);
});

test('preview deploy stays prebuilt with the required archive flag', () => {
  assert.match(executable, /deploy\s+--yes\s+--prebuilt\s+--archive=tgz/);
});

test('preview workflow runs on github-hosted runners only', () => {
  assert.match(workflow, /runs-on:\s*ubuntu-24\.04/);
  assert.doesNotMatch(workflow, /self-hosted/);
  assert.doesNotMatch(workflow, /baci-deploy/);
  assert.doesNotMatch(workflow, /baci-vps/);
});

test('preview helpers execute from the trusted default-branch checkout', () => {
  assert.match(executable, /path:\s*trusted-ops/);
  assert.match(
    executable,
    /uses:\s*\.\/trusted-ops\/\.github\/actions\/pnpm-install-cached/
  );
  assert.match(
    executable,
    /\.\/trusted-ops\/\.github\/scripts\/pnpm-install-with-retry\.sh/
  );
  const trustedRuns = executable.match(
    /trusted-ops\/\.github\/scripts\/run-pinned-vercel\.sh/g
  );
  assert.ok(
    trustedRuns && trustedRuns.length >= 3,
    'pull, build, and deploy must invoke the trusted runner'
  );
  assert.doesNotMatch(executable, /run:\s*\.github\/scripts\//);
  assert.doesNotMatch(executable, /run:\s*node\s+\.github\/scripts\//);
  assert.doesNotMatch(executable, /uses:\s*\.\/\.github\/actions\//);
});

test('deployment secrets stay off the job-level environment', () => {
  const jobEnv = workflow.match(/\n {4}env:\n((?: {6}[^\n]*\n)+)/)?.[1];
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

test('deployment token reaches only the trusted pull and deploy steps', () => {
  const count = (name) =>
    executable.match(new RegExp(`^\\s*${name}:`, 'gm'))?.length ?? 0;
  assert.equal(count('VERCEL_TOKEN'), 2);
  assert.equal(count('VERCEL_ORG_ID'), 2);
  assert.equal(count('VERCEL_PROJECT_ID'), 2);
  assert.equal(count('TURBO_TOKEN'), 1);
  assert.equal(count('TURBO_TEAM'), 1);
});

test('preview URL parsing anchors on the deploy assignment line', () => {
  assert.match(executable, /grep -i 'preview:'/);
});

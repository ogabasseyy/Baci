import assert from 'node:assert/strict';
import test from 'node:test';
import {
  executable,
  jobBlock,
} from './preview-workflow-contract.helpers.mjs';

test('free-form ref never reaches a shell script', () => {
  const lines = executable.split('\n');
  let inRunBlock = false;
  for (const line of lines) {
    if (/^\s*run:\s*\|/.test(line)) {
      inRunBlock = true;
      continue;
    }
    if (/^\s*run:\s*\S/.test(line)) {
      assert.doesNotMatch(line, /inputs\.ref/);
      assert.doesNotMatch(line, /github\.ref/);
      inRunBlock = false;
      continue;
    }
    if (inRunBlock) {
      if (/^\s{10,}\S/.test(line)) {
        assert.doesNotMatch(line, /inputs\.ref/);
        assert.doesNotMatch(line, /github\.ref/);
        continue;
      }
      inRunBlock = false;
    }
  }
  for (const line of lines.filter((candidate) =>
    candidate.includes('inputs.ref')
  )) {
    assert.match(
      line,
      /^\s*(group|ref|PREVIEW_REF):/,
      'inputs.ref is allowed only in concurrency, checkout, and env positions'
    );
  }
});

test('artifacts expire at minimum retention', () => {
  const retentions =
    executable.match(/retention-days:\s*1\b/g) ?? [];
  assert.equal(retentions.length, 2);
});

test('preview URL parsing anchors on the deploy assignment line', () => {
  const deploy = jobBlock('deploy');
  assert.match(deploy, /grep -oiE 'preview:/);
  assert.match(deploy, /https:\/\/\[\^ \]\+\\.vercel\\.app/);
  // Last match wins (Vercel prints the assignment after upload echoes;
  // same convention as deploy-with-retry.sh). Never first-match.
  assert.match(deploy, /\|\s*tail -n 1/);
  assert.doesNotMatch(deploy, /head -n 1/);
  // No-match grep must not exit the step under pipefail before the
  // status-aware handling runs.
  assert.match(deploy, /tail -n 1 \|\| true/);
  assert.match(deploy, /exit 1/);
});

test('deploy step fails fast with the true CLI exit code', () => {
  const deploy = jobBlock('deploy');
  assert.match(deploy, /set -euo pipefail/);
});

test('deploy step survives CLI hangs and captures diagnostics', () => {
  const deploy = jobBlock('deploy');
  assert.match(deploy, /2>&1 \| tee preview-deploy\.log/);
  assert.match(deploy, /timeout[^\n]*run-pinned-vercel\.sh deploy/);
  assert.match(deploy, /PIPESTATUS\[0\]/);
  assert.match(deploy, /deploy_status.*124/);
  // Non-timeout failures reject the run even when a URL was printed.
  assert.match(deploy, /deploy_status" -ne 0.*-ne 124.*-ne 137/);
});

test('deploy job bootstraps pnpm before helpers', () => {
  const deploy = jobBlock('deploy');
  assert.match(
    deploy,
    /pnpm\/action-setup@0ebf47130e4866e96fce0953f49152a61190b271/
  );
  assert.ok(
    deploy.indexOf('pnpm/action-setup') <
      deploy.indexOf('pull --yes --environment=preview'),
    'pnpm setup must precede the first CLI invocation'
  );
});

test('handoff artifacts survive reruns', () => {
  const overwrites = executable.match(/overwrite:\s*true/g) ?? [];
  assert.equal(overwrites.length, 2);
});

test('deploy summary neutralizes markdown in the branch name', () => {
  const deploy = jobBlock('deploy');
  assert.match(deploy, /safe_ref=.*tr -d '\\n\\r`'/);
  assert.match(deploy, /Preview ready for \\`\$safe_ref\\`/);
  assert.doesNotMatch(deploy, /\$PREVIEW_REF:\s*\$preview_url/);
});

test('trusted checkouts pin the running commit, never the branch name', () => {
  const refs = [...executable.matchAll(/^\s*ref:\s*\$\{\{\s*([a-z._]+)\s*\}\}/gm)].map(
    (match) => match[1]
  );
  assert.deepEqual(refs.sort(), [
    'github.sha',
    'github.sha',
    'github.sha',
    'inputs.ref',
  ]);
});

test('untrusted build reads but never writes the remote cache', () => {
  const build = jobBlock('build');
  assert.match(build, /TURBO_CACHE:\s*"remote:r,local:rw"/);
});

test('no checkout persists credentials or takes credential inputs', () => {
  const checkoutSteps = executable
    .split('\n      - ')
    .filter((step) => step.includes('actions/checkout@'));
  assert.equal(checkoutSteps.length, 4);
  for (const step of checkoutSteps) {
    assert.match(step, /persist-credentials:\s*false/);
    assert.doesNotMatch(step, /^\s*token:/m);
    assert.doesNotMatch(step, /^\s*ssh-key:/m);
  }
});

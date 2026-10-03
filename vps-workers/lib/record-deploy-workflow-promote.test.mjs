import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  BRANCH,
  fixtureOrigin,
  libPath,
  recordCommits,
  recordContent,
  runRecord,
  SHA,
  SHA2,
  systemBash,
  tsvRows,
  workRepo,
} from './record-deploy-workflow-promote.test-fixtures.mjs';

// Pre-promote refusal coverage lives in
// check-deploy-workflow-inflight.test.mjs, and restore-phase coverage
// in record-deploy-workflow-restore.test.mjs (split to keep every
// suite under the 300-line limit).

test('creates the ops branch with the promoted SHA and run ids', () => {
  const { bare, result } = runRecord({
    runIds: tsvRows('184400111', '184400112'),
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(recordContent(bare), `${SHA}:184400111,184400112`);
  assert.match(result.stdout, new RegExp(`Recorded worker promote ${SHA}`));
  assert.match(result.stdout, /overlapping runs: 184400111,184400112/);
  const message = execFileSync(
    'git',
    ['--git-dir', bare, 'log', '-1', '--format=%s', BRANCH],
    {
      encoding: 'utf8',
    }
  );
  assert.match(message, /\[skip ci\]/);
});

test('updates the existing record on the next promote', () => {
  const bare = fixtureOrigin();
  const first = runRecord({ origin: bare, runIds: tsvRows('1') });
  assert.equal(first.result.status, 0, first.result.stderr);
  const second = runRecord({
    origin: bare,
    sha: SHA2,
    runIds: tsvRows('2', '3'),
  });

  assert.equal(second.result.status, 0, second.result.stderr);
  assert.equal(recordContent(bare), `${SHA2}:2,3`);
  assert.equal(recordCommits(bare).length, 2);
});

test('records an empty run list when nothing overlaps', () => {
  const { bare, result } = runRecord({ runIds: '' });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(recordContent(bare), `${SHA}:`);
  assert.match(result.stdout, /no overlapping runs/);
});

test('exits 1 when the branch cannot be pushed', () => {
  const { result } = runRecord({
    origin: join(tmpdir(), 'baci-promote-missing-origin.git'),
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /NOT recorded/);
  assert.match(result.stderr, /after 3 attempts/);
  assert.match(result.stderr, /must not stay unrecorded/);
});

test('exits 1 when the run list cannot be fetched', () => {
  const { bare, result } = runRecord({ scenario: 'listfail' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /NOT recorded/);
  assert.match(result.stderr, /could not list workflow runs/);
  assert.throws(() => recordContent(bare));
});

test('exits 1 when the repo cannot be resolved', () => {
  const { result } = runRecord({ env: { BACI_DEPLOY_WORKFLOW_REPO: '' } });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /cannot resolve the deploy repo/);
});

test('rejects a malformed SHA', () => {
  const { result } = runRecord({ sha: 'not-a-sha' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /40-hex SHA/);
});

test('exits 1 when gh is missing', () => {
  const bare = fixtureOrigin();
  const work = workRepo(bare);
  const binDir = join(work, 'stub-bin');
  mkdirSync(binDir, { recursive: true });
  const result = spawnSync(
    systemBash,
    [
      '-c',
      'set -euo pipefail; source "$RECORD_LIB"; record_deploy_workflow_promote "$RECORD_SHA"',
    ],
    {
      cwd: work,
      encoding: 'utf8',
      env: {
        ...process.env,
        BACI_DEPLOY_SKIP_INFLIGHT_CHECK: '',
        BACI_DEPLOY_WORKFLOW_REPO: 'example-owner/example-repo',
        RECORD_LIB: libPath,
        RECORD_SHA: SHA,
        PATH: binDir,
      },
    }
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /gh CLI is not installed/);
});

test('bypass still records the promote', () => {
  const { bare, result } = runRecord({
    runIds: tsvRows('184400111'),
    env: { BACI_DEPLOY_SKIP_INFLIGHT_CHECK: '1' },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(recordContent(bare), `${SHA}:184400111`);
});

test('bypass push failure warns and proceeds', () => {
  const { result } = runRecord({
    origin: join(tmpdir(), 'baci-promote-missing-origin.git'),
    env: { BACI_DEPLOY_SKIP_INFLIGHT_CHECK: '1' },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /WARNING/);
  assert.match(result.stderr, /NOT recorded/);
});

test('pre-flip gate writes the same record shape', () => {
  const { bare, result } = runRecord({
    phase: 'pre',
    runIds: tsvRows('184400111'),
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(recordContent(bare), `${SHA}:184400111`);
  assert.match(result.stdout, /Recorded pre-promote overlap/);
});

test('pre-flip gate refuses before mutation when the push fails', () => {
  const { result } = runRecord({
    phase: 'pre',
    origin: join(tmpdir(), 'baci-promote-missing-origin.git'),
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing worker promotion/);
  assert.match(result.stderr, /Nothing was mutated/);
  assert.match(result.stderr, /after 3 attempts/);
  assert.doesNotMatch(result.stderr, /already landed/);
});

test('pre-flip gate refuses before mutation when the run list fails', () => {
  const { result } = runRecord({ phase: 'pre', scenario: 'listfail' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing worker promotion/);
  assert.match(result.stderr, /Nothing was mutated/);
  assert.doesNotMatch(result.stderr, /already landed/);
});

test('rejects an unknown record phase', () => {
  const { result } = runRecord({ phase: 'bogus' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown phase/);
  assert.match(result.stderr, /want 'pre', 'post', or 'restore'/);
});

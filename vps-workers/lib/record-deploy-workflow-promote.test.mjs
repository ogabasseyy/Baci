import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Pre-promote refusal coverage lives in
// check-deploy-workflow-inflight.test.mjs (extracted to keep both suites
// under the 300-line limit).

const scriptDir = dirname(fileURLToPath(import.meta.url));
const libPath = join(scriptDir, 'check-deploy-workflow-inflight.sh');
const systemBash = existsSync('/bin/bash') ? '/bin/bash' : 'bash';
const SHA = '0123456789abcdef0123456789abcdef01234567';
const SHA2 = '123456789abcdef0123456789abcdef012345678';
const BRANCH = 'ops/gigl-promote-record';

function fixtureOrigin() {
  const bare = join(
    mkdtempSync(join(tmpdir(), 'baci-promote-origin-')),
    'origin.git'
  );
  execFileSync('git', ['init', '--quiet', '--bare', bare]);
  return bare;
}

function workRepo(origin) {
  const work = mkdtempSync(join(tmpdir(), 'baci-promote-work-'));
  execFileSync('git', ['init', '--quiet', work]);
  execFileSync('git', ['-C', work, 'remote', 'add', 'origin', origin]);
  return work;
}

function recordContent(bare) {
  return execFileSync(
    'git',
    ['--git-dir', bare, 'show', `${BRANCH}:.gigl-promote-record`],
    {
      encoding: 'utf8',
    }
  ).trim();
}

function recordCommits(bare) {
  return execFileSync('git', ['--git-dir', bare, 'rev-list', BRANCH], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n');
}

// TSV rows (id, status, short-sha, event, url), the `gh api --jq @tsv`
// contract the record parser consumes.
const tsvRows = (...ids) =>
  ids
    .map(
      (id, index) =>
        `${id}\tin_progress\tabc${index}def\tpush\thttps://example.invalid/runs/${id}`
    )
    .join('\n');

function runRecord({
  sha = SHA,
  scenario = 'ok',
  runIds = '',
  origin = null,
  env = {},
  path = null,
}) {
  const bare = origin ?? fixtureOrigin();
  const work = workRepo(bare);
  const binDir = join(work, 'stub-bin');
  mkdirSync(binDir, { recursive: true });
  const stubPath = join(binDir, 'gh');
  writeFileSync(
    stubPath,
    `#!/usr/bin/env bash
if [ "$GH_SCENARIO" = "listfail" ]; then echo 'gh: API error' >&2; exit 1; fi
# A real run carries exactly one status, so it surfaces under exactly
# one of the four status queries; answering every call would
# quadruple every id.
if [ ! -f "$GH_FIRST_CALL_MARKER" ]; then printf '%s' "$GH_RUN_IDS"; : > "$GH_FIRST_CALL_MARKER"; fi
`
  );
  chmodSync(stubPath, 0o755);
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
        // file:// fixture origins never parse as github remotes; the
        // override is the deterministic repo for the run-list query.
        BACI_DEPLOY_WORKFLOW_REPO: 'example-owner/example-repo',
        ...env,
        RECORD_LIB: libPath,
        RECORD_SHA: sha,
        GH_SCENARIO: scenario,
        GH_RUN_IDS: runIds,
        GH_FIRST_CALL_MARKER: join(work, 'gh-first-call'),
        PATH: path ?? `${binDir}:${process.env.PATH}`,
      },
    }
  );
  return { bare, result };
}

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
  assert.match(
    result.stderr,
    new RegExp(`record_deploy_workflow_promote '${SHA}'`)
  );
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

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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

function writeStub(binDir, name, body) {
  const path = join(binDir, name);
  writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(path, 0o755);
}

function runRecord({
  sha = SHA,
  scenario = 'ok',
  runIds = '',
  gitBody = 'if [ "$1 $2 $3" = "remote get-url origin" ]; then echo \'https://github.com/example-owner/example-repo.git\'; else exit 1; fi',
  env = {},
}) {
  const workDir = mkdtempSync(join(tmpdir(), 'baci-promote-record-'));
  const binDir = join(workDir, 'bin');
  mkdirSync(binDir, { recursive: true });
  const argsFile = join(workDir, 'gh-args.txt');
  writeStub(
    binDir,
    'gh',
    `echo "$@" >> "$GH_ARGS_FILE"
case "$*" in
  *"run list"*)
    if [ "$GH_SCENARIO" = "listfail" ]; then echo 'gh: API error' >&2; exit 1; fi
    printf '%s' "$GH_RUN_IDS"
    ;;
  *"PATCH"*)
    if [ "$GH_SCENARIO" = "patch404" ] || [ "$GH_SCENARIO" = "writefail" ]; then echo 'gh: Not Found (HTTP 404)' >&2; exit 1; fi
    exit 0
    ;;
  *"actions/variables"*)
    if [ "$GH_SCENARIO" = "writefail" ]; then echo 'gh: Forbidden (HTTP 403)' >&2; exit 1; fi
    exit 0
    ;;
  *) exit 0 ;;
esac`.replaceAll('$GH_ARGS_FILE', argsFile)
  );
  if (gitBody !== null) {
    writeStub(binDir, 'git', gitBody);
  }
  const result = spawnSync(
    systemBash,
    [
      '-c',
      'set -euo pipefail; source "$RECORD_LIB"; record_deploy_workflow_promote "$RECORD_SHA"',
    ],
    {
      cwd: workDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        BACI_DEPLOY_SKIP_INFLIGHT_CHECK: '',
        BACI_DEPLOY_WORKFLOW_REPO: '',
        ...env,
        RECORD_LIB: libPath,
        RECORD_SHA: sha,
        GH_SCENARIO: scenario,
        GH_RUN_IDS: runIds,
        PATH: `${binDir}:${process.env.PATH}`,
      },
    }
  );
  return {
    result,
    ghArgs: existsSync(argsFile) ? readFileSync(argsFile, 'utf8') : '',
  };
}

test('records the promoted SHA with overlapping run ids', () => {
  const { result, ghArgs } = runRecord({ runIds: '184400111,184400112' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    ghArgs,
    /PATCH repos\/example-owner\/example-repo\/actions\/variables\/GIGL_WORKER_PROMOTE_RECORD/
  );
  assert.match(ghArgs, new RegExp(`value=${SHA}:184400111,184400112`));
  assert.match(result.stdout, new RegExp(`Recorded worker promote ${SHA}`));
  assert.match(result.stdout, /overlapping runs: 184400111,184400112/);
});

test('records an empty run list when nothing overlaps', () => {
  const { result, ghArgs } = runRecord({ runIds: '' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(ghArgs, new RegExp(`value=${SHA}:\\s*$`, 'm'));
  assert.match(result.stdout, /no overlapping runs/);
});

test('creates the variable when PATCH answers 404', () => {
  const { result, ghArgs } = runRecord({ scenario: 'patch404', runIds: '7' });

  assert.equal(result.status, 0, result.stderr);
  const apiCalls = ghArgs
    .split('\n')
    .filter((line) => line.includes('actions/variables'));
  assert.equal(apiCalls.length, 2);
  assert.match(apiCalls[0], /PATCH/);
  assert.doesNotMatch(apiCalls[1], /PATCH/);
  assert.match(apiCalls[1], /name=GIGL_WORKER_PROMOTE_RECORD/);
  assert.match(apiCalls[1], new RegExp(`value=${SHA}:7`));
});

test('exits 1 when the record cannot be written', () => {
  const { result } = runRecord({ scenario: 'writefail', runIds: '7' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /NOT recorded/);
  assert.match(
    result.stderr,
    new RegExp(`record_deploy_workflow_promote '${SHA}'`)
  );
});

test('exits 1 when the run list cannot be fetched', () => {
  const { result } = runRecord({ scenario: 'listfail' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /NOT recorded/);
  assert.match(result.stderr, /could not list workflow runs/);
});

test('exits 1 when the repo cannot be resolved', () => {
  const { result } = runRecord({ gitBody: 'exit 1' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /cannot resolve the deploy repo/);
});

test('honors the explicit repo override', () => {
  const { result, ghArgs } = runRecord({
    gitBody: 'exit 1',
    env: { BACI_DEPLOY_WORKFLOW_REPO: 'override-owner/override-repo' },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    ghArgs,
    /repos\/override-owner\/override-repo\/actions\/variables/
  );
});

test('rejects a malformed SHA', () => {
  const { result } = runRecord({ sha: 'not-a-sha' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /40-hex SHA/);
});

test('bypass still records the promote', () => {
  const { result, ghArgs } = runRecord({
    runIds: '184400111',
    env: { BACI_DEPLOY_SKIP_INFLIGHT_CHECK: '1' },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(ghArgs, /PATCH .*GIGL_WORKER_PROMOTE_RECORD/);
});

test('bypass write failure warns and proceeds', () => {
  const { result } = runRecord({
    scenario: 'writefail',
    env: { BACI_DEPLOY_SKIP_INFLIGHT_CHECK: '1' },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /WARNING/);
  assert.match(result.stderr, /NOT recorded/);
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(scriptDir, 'refuse-publish-on-promote-overlap.sh');

function runOverlap({ scenario = 'ok', record = '', runId = '333', repo = 'example-owner/example-repo' }) {
  const workDir = mkdtempSync(join(tmpdir(), 'baci-promote-overlap-'));
  const binDir = join(workDir, 'bin');
  mkdirSync(binDir, { recursive: true });
  const argsFile = join(workDir, 'gh-args.txt');
  const stubPath = join(binDir, 'gh');
  writeFileSync(
    stubPath,
    `#!/usr/bin/env bash
echo "$@" >> "${argsFile}"
case "$GH_SCENARIO" in
  ok) printf '%s' "$GH_RECORD" ;;
  missing) echo 'gh: Not Found (HTTP 404)' >&2; exit 1 ;;
  error) echo 'gh: Internal Server Error (HTTP 500)' >&2; exit 1 ;;
esac
`
  );
  chmodSync(stubPath, 0o755);
  const result = spawnSync('bash', [scriptPath], {
    cwd: workDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      GH_SCENARIO: scenario,
      GH_RECORD: record,
      GITHUB_RUN_ID: runId,
      GITHUB_REPOSITORY: repo,
      OVERLAP_RETRY_DELAY_SECONDS: '0',
      PATH: `${binDir}:${process.env.PATH}`,
    },
  });
  return {
    result,
    ghArgs: existsSync(argsFile) ? readFileSync(argsFile, 'utf8') : '',
  };
}

test('allows publish when this run is absent from the record', () => {
  const { result, ghArgs } = runOverlap({ record: 'abc123:111,222' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No worker promote overlapped this run/);
  assert.match(result.stdout, /abc123/);
  assert.match(ghArgs, /repos\/example-owner\/example-repo\/actions\/variables\/GIGL_WORKER_PROMOTE_RECORD/);
});

test('refuses publish when this run is in the record', () => {
  const { result } = runOverlap({ record: 'abc123:111,333' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing production publish/);
  assert.match(result.stderr, /promote overlapped this run/);
  assert.match(result.stderr, /Re-run this workflow/);
});

test('matches run ids on comma boundaries, not substrings', () => {
  const { result } = runOverlap({ record: 'abc123:1333,3334' });

  assert.equal(result.status, 0, result.stderr);
});

test('allows publish when nothing was ever recorded', () => {
  const { result } = runOverlap({ scenario: 'missing' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No worker promote recorded yet/);
});

test('fails closed when the record cannot be read', () => {
  const { result, ghArgs } = runOverlap({ scenario: 'error' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /could not read GIGL_WORKER_PROMOTE_RECORD/);
  assert.equal(
    ghArgs.split('\n').filter((line) => line.includes('actions/variables')).length,
    3
  );
});

test('fails closed on an unparseable record', () => {
  const { result } = runOverlap({ record: 'no-colon-here' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /unparseable/);
});

test('allows publish when the record lists no runs', () => {
  const { result } = runOverlap({ record: 'abc123:' });

  assert.equal(result.status, 0, result.stderr);
});

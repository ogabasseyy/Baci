import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(scriptDir, 'refuse-publish-on-promote-overlap.sh');

function runOverlap({
  scenario = 'ok',
  record = '',
  runId = '333',
  repo = 'example-owner/example-repo',
  barrierScenario = 'missing',
  barriers = '',
}) {
  const workDir = mkdtempSync(join(tmpdir(), 'baci-promote-overlap-'));
  const binDir = join(workDir, 'bin');
  mkdirSync(binDir, { recursive: true });
  const argsFile = join(workDir, 'gh-args.txt');
  const stubPath = join(binDir, 'gh');
  writeFileSync(
    stubPath,
    `#!/usr/bin/env bash
echo "$@" >> "${argsFile}"
case "$@" in
  *contents/barriers?*)
    case "$GH_BARRIER_SCENARIO" in
      blocked) printf '%s' "$GH_BARRIERS" ;;
      missing) echo 'gh: Not Found (HTTP 404)' >&2; exit 1 ;;
      error) echo 'gh: Internal Server Error (HTTP 500)' >&2; exit 1 ;;
    esac
    ;;
  *)
    case "$GH_SCENARIO" in
      ok) printf '%s' "$GH_RECORD" ;;
      missing) echo 'gh: Not Found (HTTP 404)' >&2; exit 1 ;;
      error) echo 'gh: Internal Server Error (HTTP 500)' >&2; exit 1 ;;
    esac
    ;;
esac
`
  );
  chmodSync(stubPath, 0o755);
  // Execute exactly as deploy.yml does so a missing executable bit fails CI.
  const result = spawnSync(scriptPath, [], {
    cwd: workDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      GH_SCENARIO: scenario,
      GH_RECORD: record,
      GH_BARRIER_SCENARIO: barrierScenario,
      GH_BARRIERS: barriers,
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
  // Contents API under contents:read (GITHUB_TOKEN cannot be granted
  // the Variables permission a variable-backed record would need).
  assert.match(
    ghArgs,
    /repos\/example-owner\/example-repo\/contents\/\.gigl-promote-record\?ref=ops\/gigl-promote-record/
  );
  assert.doesNotMatch(ghArgs, /actions\/variables/);
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

test('fails closed when the record is missing', () => {
  // No genuine first rollout reaches this script: deploy-production
  // needs the cutover marker, which only exists after a deploy.sh
  // promote — and every promote writes this record first. A 404 is a
  // broken safety store, not an unseeded one.
  const { result } = runOverlap({ scenario: 'missing' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing production publish/);
  assert.match(result.stderr, /promote record.*is missing/);
  assert.match(result.stderr, /record_deploy_workflow_promote/);
});

test('fails closed when the record cannot be read', () => {
  const { result, ghArgs } = runOverlap({ scenario: 'error' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /could not read the worker promote record/);
  assert.equal(
    ghArgs.split('\n').filter((line) => line.includes('contents/.gigl-promote-record')).length,
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

test('refuses publish when a barrier file exists, even if unlisted', () => {
  // The run id is absent (it started after the pre-flip snapshot),
  // but a promote is mid-flight: the ID list alone would allow.
  const { result } = runOverlap({
    record: 'abc123:111,222',
    barrierScenario: 'blocked',
    barriers:
      '[{"name":"abc-host-1","path":"barriers/abc-host-1","type":"file"}]',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing production publish/);
  assert.match(result.stderr, /promote is in progress/);
  assert.match(result.stderr, /stale barrier/);
});

test('refuses publish when the barriers path is a file, not a directory', () => {
  const { result } = runOverlap({
    record: 'abc123:',
    barrierScenario: 'blocked',
    barriers: '{"name":"barriers","path":"barriers","type":"file"}',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /promote is in progress/);
});

test('fails closed when the barriers cannot be read', () => {
  const { result, ghArgs } = runOverlap({
    record: 'abc123:',
    barrierScenario: 'error',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /could not read the worker promote barriers/);
  assert.equal(
    ghArgs.split('\n').filter((line) => line.includes('contents/barriers')).length,
    3
  );
});

test('allows publish when the barriers directory is absent', () => {
  const { result } = runOverlap({
    record: 'abc123:',
    barrierScenario: 'missing',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No worker promote overlapped this run/);
});

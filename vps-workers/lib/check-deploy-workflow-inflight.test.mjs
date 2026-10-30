import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  libPath,
  RECORD_ARGS,
  runCheck,
  systemBash,
} from './check-deploy-workflow-inflight.test-fixtures.mjs';

// Promote-record coverage lives in record-deploy-workflow-promote.test.mjs
// (extracted to keep both suites under the 300-line limit).
// Repo-resolution, shell-compat, and deploy.sh-order coverage lives in
// check-deploy-workflow-inflight-repo.test.mjs (same reason).

test('passes when no production deploy run is in flight', () => {
  const { result, ghArgs } = runCheck({ ghBody: RECORD_ARGS });

  assert.equal(result.status, 0, result.stderr);
  // Only main-branch runs of the publishing workflow can land the
  // cron removal, so the query scopes to exactly those — via the
  // Actions API (server-side status filter + pagination), never a
  // fixed recent-run window that could miss an approval-held run.
  assert.match(
    ghArgs,
    /repos\/ogabasseyy\/Baci\/actions\/workflows\/production-release\.yml\/runs\?branch=main/
  );
  assert.match(ghArgs, /--paginate/);
  assert.match(ghArgs, /--jq/);
});

test('queries every non-completed status without a fixed window', () => {
  const { result, ghArgs } = runCheck({
    ghBody: 'echo "$@" >> "$GH_ARGS_FILE"',
  });

  assert.equal(result.status, 0, result.stderr);
  // Two consecutive stable passes prove nothing transitioned
  // mid-scan; a single pass can always dodge.
  const calls = ghArgs.split('\n').filter(Boolean);
  assert.equal(calls.length, 24);
  // Mirrors IN_FLIGHT_RUN_STATUSES in coordinate-production-release.mjs:
  // an approval-parked run can still publish later.
  for (const status of [
    'queued',
    'in_progress',
    'waiting',
    'requested',
    'pending',
    'action_required',
  ]) {
    assert.equal(
      calls.filter((call) => call.includes(`status=${status}`)).length,
      4,
      `expected two status=${status} queries`
    );
  }
  for (const call of calls) {
    assert.match(call, /--paginate/);
    assert.match(call, /actions\/workflows\/(?:deploy|production-release)\.yml\/runs\?branch=main/);
  }
});

test('captures a run that transitions status mid-scan', () => {
  // requested -> queued between passes: both passes observe the id
  // (stable set), so the scan stops after two passes and the union
  // keeps the run exactly once.
  const transitionStub = (queuedFrom) =>
    [
      'echo "$@" >> "$GH_ARGS_FILE"',
      'n=$(($(cat "$GH_ARGS_FILE.count" 2>/dev/null || echo 0) + 1)); echo "$n" >"$GH_ARGS_FILE.count"',
      'case "$*" in',
      '  *status=requested*) if [ "$n" -le 6 ]; then printf \'184400113\\trequested\\tabc99999\\tpush\\thttps://example.invalid/runs/184400113\\n\'; fi;;',
      `  *status=queued*) if [ "$n" -ge ${queuedFrom} ]; then printf '184400113\\tqueued\\tabc99999\\tpush\\thttps://example.invalid/runs/184400113\\n'; fi;;`,
      'esac',
      'exit 0',
    ].join('\n');
  const { result, ghArgs } = runCheck({ ghBody: transitionStub(7) });

  assert.equal(result.status, 1);
  assert.equal(ghArgs.split('\n').filter(Boolean).length, 12);
  // Exactly one unioned row: the id plus its run URL (two mentions).
  assert.equal(result.stderr.match(/184400113/g).length, 2);
});

test('re-scans when a pass diverges', () => {
  // The run dodges the whole second pass (between statuses at every
  // query) and reappears in the third: the divergent pass forces a
  // third scan instead of settling on the gapped set.
  const { result, ghArgs } = runCheck({
    ghBody: [
      'echo "$@" >> "$GH_ARGS_FILE"',
      'n=$(($(cat "$GH_ARGS_FILE.count" 2>/dev/null || echo 0) + 1)); echo "$n" >"$GH_ARGS_FILE.count"',
      'case "$*" in',
      '  *status=requested*) if [ "$n" -le 6 ]; then printf \'184400114\\trequested\\tabc99998\\tpush\\thttps://example.invalid/runs/184400114\\n\'; fi;;',
      '  *status=queued*) if [ "$n" -ge 13 ]; then printf \'184400114\\tqueued\\tabc99998\\tpush\\thttps://example.invalid/runs/184400114\\n\'; fi;;',
      'esac',
      'exit 0',
    ].join('\n'),
  });

  assert.equal(result.status, 1);
  assert.equal(ghArgs.split('\n').filter(Boolean).length, 18);
  // Exactly one unioned row: the id plus its run URL (two mentions).
  assert.equal(result.stderr.match(/184400114/g).length, 2);
});

test('refuses promotion while a deploy run is in progress', () => {
  const { result } = runCheck({
    ghBody: `${RECORD_ARGS}\nprintf '184400111\\tin_progress\\tabc12345\\tpush\\thttps://github.com/example/repo/actions/runs/184400111\\n'`,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing worker promotion/);
  assert.match(result.stderr, /184400111/);
  assert.match(result.stderr, /in_progress/);
  assert.match(result.stderr, /rerun deploy\.sh/);
});

test('treats approval-held runs as in flight', () => {
  // A run waiting on the production environment approval publishes
  // later off the same early latch/SHA read, so `waiting` must block
  // promotion just like an actively running deploy.
  const { result } = runCheck({
    ghBody: `${RECORD_ARGS}\nprintf '184400112\\twaiting\\tdef67890\\tworkflow_dispatch\\thttps://github.com/example/repo/actions/runs/184400112\\n'`,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing worker promotion/);
  assert.match(result.stderr, /184400112/);
});

test('the in-flight query preserves approval-parked runs', () => {
  const lib = readFileSync(libPath, 'utf8');
  assert.match(
    lib,
    /select\(\.status != "completed" or \.conclusion == "action_required"\)/
  );
});

test('checks the coordinator lock at its baci-release-owned path', () => {
  const source = readFileSync(libPath, 'utf8');
  const lockSource = readFileSync(
    new URL('../../.github/scripts/production-release-lock.mjs', import.meta.url),
    'utf8'
  );
  const statusSource = readFileSync(
    new URL('../bin/production_release_lock_status.py', import.meta.url),
    'utf8'
  );
  const filesystemSource = readFileSync(
    new URL('../bin/production_release_lock_status_fs.py', import.meta.url),
    'utf8'
  );
  const unitSource = readFileSync(
    new URL('../systemd/baci-production-release-lock-status.service', import.meta.url),
    'utf8'
  );
  const configuredPath = lockSource.match(
    /PRODUCTION_RELEASE_LOCK_PATH = '([^']+)'/
  )?.[1];

  assert.equal(
    configuredPath,
    '/home/baci-release/.local/state/baci/pending-production-release.json'
  );
  assert.match(statusSource, /LOCK_VIEW_DIRECTORY = Path\("\/run\/baci-worker-release-status\/lock-state"\)/);
  assert.match(statusSource, /LOCK_PATH = LOCK_VIEW_DIRECTORY \/ LOCK_FILENAME/);
  assert.match(unitSource, /BindReadOnlyPaths=\/home\/baci-release\/\.local\/state\/baci:\/run\/baci-worker-release-status\/lock-state/);
  assert.match(filesystemSource, /"\/home\/baci-release\/\.local\/state\/baci"/);
  assert.match(filesystemSource, /"\/baci-release\/\.local\/state\/baci"/);
  assert.doesNotMatch(filesystemSource, /\/proc\/1\/root/);
  assert.match(source, /production_release_lock_status\.py'\s*\n\s*\[ -x "\$status_helper" \]/);
  assert.match(source, /case "\$lock_status" in[\s\S]*?unlocked\)[\s\S]*?locked\)/);
  assert.match(source, /production-release-lock\.mjs" authorize-worker-lock/);
});

test('fails closed when the lock-status endpoint is missing', () => {
  const { result, ghArgs } = runCheck({
    ghBody: RECORD_ARGS,
    statusAvailable: false,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /read-only production release lock status endpoint is unavailable/);
  assert.equal(ghArgs, '');
});

test('fails closed on a malformed lock-status response', () => {
  const { result, ghArgs } = runCheck({ ghBody: RECORD_ARGS, lockStatus: 'maybe' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /production release lock status response is invalid/);
  assert.equal(ghArgs, '');
});

test('refuses promotion while an approval-parked run is listed', () => {
  const { result } = runCheck({
    ghBody: `${RECORD_ARGS}\nprintf '184400115\\tcompleted\\tabc54321\\tworkflow_dispatch\\thttps://github.com/example/repo/actions/runs/184400115\\n'`,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing worker promotion/);
  assert.match(result.stderr, /184400115/);
});

test('scp-style credentials never leak into refusal errors', () => {
  const { result, ghArgs } = runCheck({
    ghBody: RECORD_ARGS,
    gitBody:
      'if [ "$1 $2 $3" = "remote get-url origin" ]; then echo \'ghp_SCPLEAK2@github.com:ogabasseyy/Baci.git\'; else exit 1; fi',
  });

  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr, /ghp_SCPLEAK2/);
  assert.equal(ghArgs, '');
});

test('fails closed when the run list cannot be fetched', () => {
  const { result } = runCheck({
    ghBody: `${RECORD_ARGS}\necho 'error: authentication required' >&2\nexit 1`,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing worker promotion/);
  assert.match(result.stderr, /gh auth login/);
});

test('fails closed when gh is missing', () => {
  const workDir = mkdtempSync(join(tmpdir(), 'baci-inflight-no-gh-'));
  const binDir = join(workDir, 'bin');
  mkdirSync(binDir, { recursive: true });
  const result = spawnSync(
    systemBash,
    [
      '-c',
      'set -euo pipefail; source "$CHECK_LIB"; check_deploy_workflow_inflight',
    ],
    {
      cwd: workDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        BACI_DEPLOY_SKIP_INFLIGHT_CHECK: '',
        BACI_DEPLOY_WORKFLOW_REPO: 'ogabasseyy/Baci',
        CHECK_LIB: libPath,
        // No gh on PATH: only the empty stub dir, so `command -v gh`
        // fails before any other tool is needed.
        PATH: binDir,
      },
    }
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /pinned GitHub CLI is missing or has an untrusted owner or mode/);
});

test('caller supplied emergency bypass input does not bypass an active deploy run', () => {
  const { result } = runCheck({
    ghBody: `${RECORD_ARGS}\necho '184400111 in_progress abc12345 push https://example.invalid/runs/1'`,
    env: { BACI_DEPLOY_SKIP_INFLIGHT_CHECK: '1' },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /production deploy run/);
  assert.doesNotMatch(result.stderr, /skipping the pre-promote/);
});

test('forged run context and PATH-spoofed Node or gh cannot authorize a manual worker process', () => {
  const dir = mkdtempSync(join(tmpdir(), 'baci-hostile-path-'));
  const marker = join(dir, 'node-was-run');
  const { result } = runCheck({
    ghBody: [
      'echo "$@" >> "$GH_ARGS_FILE"',
      'case "$*" in',
      '  *production-release.yml*) printf \'184400111\\tin_progress\\tabc12345\\tpush\\thttps://example.invalid/runs/184400111\\n\';;',
      'esac',
    ].join('\n'),
    env: {
      GITHUB_RUN_ID: '184400111',
      GITHUB_SHA: 'a'.repeat(40),
      GITHUB_JOB: 'workers',
      BACI_DEPLOY_WORKFLOW_REPO: 'ogabasseyy/Baci',
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://attacker.invalid/token',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'forged',
    },
    nodeBody: `echo called > '${marker}'\nprintf '184400111\\tdeadbeef\\t1\\n'`,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /production release coordinator is active and this process is not its authenticated worker job/);
  assert.equal(existsSync(marker), false);
});

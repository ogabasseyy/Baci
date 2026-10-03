import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  deployPath,
  RECORD_ARGS,
  runCheck,
  systemBash,
} from './check-deploy-workflow-inflight.test-fixtures.mjs';

// Split from check-deploy-workflow-inflight.test.mjs: repo-resolution,
// shell-compat, and deploy.sh-order pins live here so both suites stay
// under the 300-line limit.

test('queries the origin repo explicitly so fork checkouts cannot pass vacuously', () => {
  const { result, ghArgs } = runCheck({
    ghBody: RECORD_ARGS,
    gitBody:
      'if [ "$1 $2 $3" = "remote get-url origin" ]; then echo \'git@github.com:example-owner/example-repo.git\'; else exit 1; fi',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    ghArgs,
    /repos\/example-owner\/example-repo\/actions\/workflows/
  );
});

test('fails closed when the repo cannot be resolved from origin', () => {
  // No silent fallback to gh default resolution: a fork-clone deploy
  // would query the fork (no runs) and pass vacuously while production
  // deploys fly.
  const { result, ghArgs } = runCheck({
    ghBody: RECORD_ARGS,
    gitBody: 'exit 1',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /cannot resolve the deploy repo/);
  assert.match(result.stderr, /BACI_DEPLOY_WORKFLOW_REPO/);
  assert.equal(ghArgs, '');
});

test('honors the explicit repo override for exotic remotes', () => {
  const { result, ghArgs } = runCheck({
    ghBody: RECORD_ARGS,
    gitBody: 'exit 1',
    env: { BACI_DEPLOY_WORKFLOW_REPO: 'override-owner/override-repo' },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    ghArgs,
    /repos\/override-owner\/override-repo\/actions\/workflows/
  );
});

test('rejects a malformed repo override', () => {
  const { result } = runCheck({
    ghBody: RECORD_ARGS,
    env: { BACI_DEPLOY_WORKFLOW_REPO: 'not-a-repo' },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be 'owner\/repo'/);
});

test('runs under the system shell with strict mode (bash 3.2 compatible)', () => {
  // The guard runs on operator machines where /bin/bash may be 3.2:
  // every expansion here must survive `set -u` there.
  const { result } = runCheck({ ghBody: RECORD_ARGS });

  assert.equal(result.status, 0, result.stderr);
  const version = spawnSync(systemBash, ['-c', 'echo "$BASH_VERSION"'], {
    encoding: 'utf8',
  });
  assert.match(version.stdout, /^\d+\./);
});

test('deploy.sh checks for in-flight deploys before staging and before promote', () => {
  const deploy = readFileSync(deployPath, 'utf8');
  assert.match(
    deploy,
    /source "\$WORKER_ROOT\/lib\/check-deploy-workflow-inflight\.sh"/
  );
  const calls = deploy.match(/^check_deploy_workflow_inflight$/gm) ?? [];
  assert.equal(calls.length, 2);
  const [first, second] = [
    deploy.indexOf('check_deploy_workflow_inflight'),
    deploy.lastIndexOf('check_deploy_workflow_inflight'),
  ];
  // Fail fast before the minutes-long staging, then re-check after
  // the image build but BEFORE the cron transition mutates live
  // schedule: refusing after the transition would strand candidate
  // jobs against the old unsynchronized tree until an operator
  // retries. The overlap record (pre-flip gate + post-flip refresh)
  // covers the remaining window in the other direction (workflow
  // pre-publish overlap check).
  assert.ok(first < deploy.indexOf('prepare_worker_release'));
  assert.ok(second < deploy.indexOf('install_remediation_cron_transition'));
  assert.ok(second < deploy.indexOf('promote_worker_release'));
  // The overlap record is written TWICE: a bare pre-flip gate (a
  // broken record path refuses under set -e before anything is
  // mutated — a promote can never land that no workflow can see) and
  // a captured post-flip refresh (a failed refresh completes the
  // installs below, then fails honestly; the pre-flip record still
  // stands and blocks every run in flight at flip time).
  assert.match(deploy, /^record_deploy_workflow_promote "\$APP_SHA" pre$/m);
  assert.match(
    deploy,
    /^record_deploy_workflow_promote "\$APP_SHA" \|\| record_status=\$\?$/m
  );
  const promoteIndex = deploy.indexOf('promote_worker_release');
  assert.ok(
    deploy.indexOf('record_deploy_workflow_promote "$APP_SHA" pre') <
      promoteIndex,
    'expected the fail-closed record gate before the flip'
  );
  assert.ok(
    deploy.indexOf('record_deploy_workflow_promote "$APP_SHA" ||') >
      promoteIndex,
    'expected the record refresh after the flip'
  );
});

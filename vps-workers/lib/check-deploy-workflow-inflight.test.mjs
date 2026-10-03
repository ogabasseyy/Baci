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

const scriptDir = dirname(fileURLToPath(import.meta.url));
const libPath = join(scriptDir, 'check-deploy-workflow-inflight.sh');
const deployPath = join(scriptDir, '..', 'deploy.sh');
const systemBash = existsSync('/bin/bash') ? '/bin/bash' : 'bash';

function writeStub(binDir, name, body) {
  const path = join(binDir, name);
  writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

function runCheck({ ghBody, gitBody = null, env = {}, path = null }) {
  const workDir = mkdtempSync(join(tmpdir(), 'baci-inflight-'));
  const binDir = join(workDir, 'bin');
  mkdirSync(binDir, { recursive: true });
  const argsFile = join(workDir, 'gh-args.txt');
  writeStub(binDir, 'gh', ghBody.replaceAll('__ARGS_FILE__', argsFile));
  if (gitBody !== null) {
    writeStub(binDir, 'git', gitBody);
  }
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
        ...env,
        CHECK_LIB: libPath,
        GH_ARGS_FILE: argsFile,
        PATH: path ?? `${binDir}:${process.env.PATH}`,
      },
    }
  );
  return {
    result,
    ghArgs: existsSync(argsFile) ? readFileSync(argsFile, 'utf8').trim() : '',
  };
}

const RECORD_ARGS = 'echo "$@" > "$GH_ARGS_FILE"';

test('passes when no production deploy run is in flight', () => {
  const { result, ghArgs } = runCheck({ ghBody: RECORD_ARGS });

  assert.equal(result.status, 0, result.stderr);
  // Only main-branch runs of the publishing workflow can land the
  // cron removal, so the query scopes to exactly those.
  assert.match(ghArgs, /--workflow deploy\.yml/);
  assert.match(ghArgs, /--branch main/);
  assert.match(ghArgs, /--json .*status/);
});

test('refuses promotion while a deploy run is in progress', () => {
  const { result } = runCheck({
    ghBody: `${RECORD_ARGS}\necho '184400111 in_progress abc12345 push https://github.com/example/repo/actions/runs/184400111'`,
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
    ghBody: `${RECORD_ARGS}\necho '184400112 waiting def67890 workflow_dispatch https://github.com/example/repo/actions/runs/184400112'`,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing worker promotion/);
  assert.match(result.stderr, /184400112/);
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
        CHECK_LIB: libPath,
        // No gh on PATH: only the empty stub dir, so `command -v gh`
        // fails before any other tool is needed.
        PATH: binDir,
      },
    }
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /gh CLI is not installed/);
});

test('bypass override proceeds with a loud warning', () => {
  const { result } = runCheck({
    ghBody: `${RECORD_ARGS}\necho '184400111 in_progress abc12345 push https://example.invalid/runs/1'`,
    env: { BACI_DEPLOY_SKIP_INFLIGHT_CHECK: '1' },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stderr,
    /WARNING: skipping the in-flight deploy-workflow check/
  );
  assert.match(result.stderr, /Re-run the GIGL smoke\/latch sequence/);
});

test('queries the origin repo explicitly so fork checkouts cannot pass vacuously', () => {
  const { result, ghArgs } = runCheck({
    ghBody: RECORD_ARGS,
    gitBody:
      'if [ "$1 $2 $3" = "remote get-url origin" ]; then echo \'git@github.com:example-owner/example-repo.git\'; else exit 1; fi',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(ghArgs, /-R example-owner\/example-repo/);
});

test('falls back to gh default repo resolution when origin is unparsable', () => {
  const { result, ghArgs } = runCheck({
    ghBody: RECORD_ARGS,
    gitBody: 'exit 1',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(ghArgs, /-R /);
});

test('runs under the system shell with strict mode (bash 3.2 compatible)', () => {
  // The guard runs on operator machines where /bin/bash may be 3.2:
  // the unset-array expansion must survive `set -u` there.
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
  // Fail fast before the minutes-long staging, then re-check in the
  // narrowest window before the live SHA flips.
  assert.ok(first < deploy.indexOf('prepare_worker_release'));
  assert.ok(second > deploy.indexOf('install_remediation_cron_transition'));
  assert.ok(second < deploy.indexOf('promote_worker_release'));
});

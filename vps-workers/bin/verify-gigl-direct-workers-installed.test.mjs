import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const verifier = join(directory, 'verify-gigl-direct-workers-installed.sh');
const temporaryDirectories = [];

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { force: true, recursive: true });
  }
});

function fixture({
  dirtyCheckout = false,
  dotenvFormRepoDir = false,
  duplicateRepoDir = false,
  duplicateTracking = false,
  staleCheckout = false,
  staleWorkflowSha = false,
  staleTrackingCommand = false,
  unusableCapability = false,
  unusableProviderEnvironment = false,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'baci-gigl-readiness-'));
  temporaryDirectories.push(root);
  const remote = join(root, 'workers');
  const fakeBin = join(root, 'bin');
  const crontab = join(root, 'crontab');
  const repo = join(root, 'repo');
  mkdirSync(join(remote, 'bin'), { recursive: true });
  mkdirSync(join(remote, 'jobs'), { recursive: true });
  mkdirSync(fakeBin, { recursive: true });
  mkdirSync(repo, { recursive: true });

  const deployedSha = 'a'.repeat(40);
  const repoEnv = duplicateRepoDir
    ? `BACI_REPO_DIR=/stale/checkout\nBACI_REPO_DIR=${repo}\n`
    : dotenvFormRepoDir
      ? `export BACI_REPO_DIR = "${repo}" # live\n`
      : `BACI_REPO_DIR=${repo}\n`;
  writeFileSync(join(remote, '.env'), repoEnv);
  writeFileSync(join(remote, 'app-checkout.sha'), `${deployedSha}\n`);

  const wrapper = join(remote, 'bin', 'process-gigl-tracking.sh');
  writeFileSync(wrapper, '#!/usr/bin/env bash\nexit 0\n');
  chmodSync(wrapper, 0o755);

  const capabilityWrapper = join(
    remote,
    'bin',
    'verify-gigl-tracking-worker-capability.sh'
  );
  writeFileSync(
    capabilityWrapper,
    `#!/usr/bin/env bash\nexit ${unusableCapability ? '1' : '0'}\n`
  );
  chmodSync(capabilityWrapper, 0o755);

  writeFileSync(
    join(remote, 'jobs', 'preflight-direct-web-workers.mjs'),
    `process.exit(${unusableProviderEnvironment ? '1' : '0'});\n`
  );

  const trackingCommand = staleTrackingCommand
    ? `${remote}/bin/process-gigl-tracking.sh`
    : `flock -n ${remote}/locks/gigl-tracking.lock bash -lc 'export NODE_ENV=production && export BACI_WORKER_PROFILE=gigl-tracking && cd ${remote} && timeout --signal=TERM --kill-after=30s 2m ${remote}/bin/process-gigl-tracking.sh'`;
  const lines = [
    `*/5 * * * * ${trackingCommand} >> ${remote}/logs/gigl-tracking.log 2>&1`,
  ];
  if (duplicateTracking) {
    lines.push(
      `0 * * * * ${remote}/bin/process-gigl-tracking.sh >> ${remote}/logs/extra-gigl.log 2>&1`
    );
  }
  writeFileSync(crontab, `${lines.join('\n')}\n`);

  const fakeCrontab = join(fakeBin, 'crontab');
  writeFileSync(fakeCrontab, '#!/usr/bin/env bash\ncat "$FAKE_CRONTAB"\n');
  chmodSync(fakeCrontab, 0o755);

  const fakeGit = join(fakeBin, 'git');
  writeFileSync(
    fakeGit,
    `#!/usr/bin/env bash
# Path-sensitive: only the checkout the fixture wrote answers, so a
# reader that resolves a duplicate assignment to the wrong directory
# fails closed instead of certifying the live path.
case "$*" in
  *"-C $FAKE_REPO_DIR rev-parse --verify HEAD"*)
    printf '%s\\n' "$FAKE_REPO_SHA"
    ;;
  *"status --porcelain=v1 --untracked-files=all"*)
    if [ "$FAKE_REPO_DIRTY" = "1" ]; then printf '%s\\n' ' M worker.ts'; fi
    ;;
  *) exit 1 ;;
esac
`
  );
  chmodSync(fakeGit, 0o755);
  return {
    crontab,
    deployedSha,
    dirtyCheckout,
    fakeBin,
    remote,
    repo,
    repoSha: staleCheckout ? 'b'.repeat(40) : deployedSha,
    workflowSha: staleWorkflowSha ? 'b'.repeat(40) : deployedSha,
  };
}

function verify(options, args = []) {
  const {
    crontab,
    dirtyCheckout,
    fakeBin,
    remote,
    repo,
    repoSha,
    workflowSha,
  } = fixture(options);
  return spawnSync('bash', [verifier, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      BACI_EXPECTED_APP_SHA: workflowSha,
      FAKE_CRONTAB: crontab,
      FAKE_REPO_DIR: repo,
      FAKE_REPO_DIRTY: dirtyCheckout ? '1' : '0',
      FAKE_REPO_SHA: repoSha,
      PATH: `${fakeBin}:${process.env.PATH}`,
      VPS_WORKER_REMOTE_DIR: remote,
    },
  });
}

describe('GIGL direct-worker deployment gate', () => {
  it('accepts exactly one installed tracking schedule', () => {
    const result = verify();

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /GIGL direct tracking worker is installed/);
  });

  it('certifies the last BACI_REPO_DIR assignment on duplicates', () => {
    // A stale line above the live one: dotenv, the scoped reader, and
    // the flip use the last assignment, so the verifier must certify
    // that same checkout — the path-sensitive fake git answers only
    // for it, so a first-match reader fails this test.
    const result = verify({ duplicateRepoDir: true });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /GIGL direct tracking worker is installed/);
  });

  it('certifies a non-strict BACI_REPO_DIR spelling', () => {
    // Every spelling the dotenv-grounded preflight accepts must
    // certify: a strict ^KEY= reader would block deployments the
    // preflight validated.
    const result = verify({ dotenvFormRepoDir: true });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /GIGL direct tracking worker is installed/);
  });

  it('blocks deployment when a direct-worker schedule is duplicated', () => {
    const result = verify({ duplicateTracking: true });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /2 total\/1 canonical/);
  });

  it('blocks deployment when the tracking command omits its production runtime contract', () => {
    const result = verify({ staleTrackingCommand: true });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /1 total\/0 canonical/);
  });

  it('blocks deployment when the delegated checkout is not the deployed worker SHA', () => {
    const result = verify({ staleCheckout: true });

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /checkout does not match the deployed worker SHA/
    );
  });

  it('blocks deployment when the installed worker is older than the workflow checkout', () => {
    const result = verify({ staleWorkflowSha: true });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /does not match the current workflow SHA/);
  });

  it('blocks deployment when the delegated checkout has uncommitted code', () => {
    const result = verify({ dirtyCheckout: true });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /checkout is dirty/);
  });

  it('blocks deployment when the restricted database credential is unusable', () => {
    const result = verify({ unusableCapability: true });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /failed its live wrapper smoke/);
  });

  it('blocks deployment when the installed provider environment has drifted', () => {
    const result = verify({ unusableProviderEnvironment: true });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /environment failed its production preflight/);
  });

  it('skips the live wrapper smoke for pre-migration readiness', () => {
    const result = verify({ unusableCapability: true }, ['--skip-live-smoke']);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /GIGL direct tracking worker is installed/);
  });

  it('passes the cutover marker on install presence despite SHA and env drift', () => {
    const result = verify(
      {
        dirtyCheckout: true,
        staleCheckout: true,
        staleWorkflowSha: true,
        unusableCapability: true,
        unusableProviderEnvironment: true,
      },
      ['--cutover-marker']
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /GIGL direct tracking worker is installed/);
  });

  it('blocks the cutover marker when the tracking schedule is missing', () => {
    const result = verify({ staleTrackingCommand: true }, ['--cutover-marker']);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /1 total\/0 canonical/);
  });

  it('rejects unknown verifier arguments', () => {
    const result = verify(undefined, ['--no-such-flag']);

    assert.equal(result.status, 2);
    assert.match(result.stderr, /Unknown argument/);
  });
});

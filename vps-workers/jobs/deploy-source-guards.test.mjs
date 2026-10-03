import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const workerRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(workerRoot, '..');
const deployScript = join(workerRoot, 'deploy.sh');
const releaseHelper = join(workerRoot, 'lib', 'prepare-worker-release.sh');

function writeExecutable(path, source) {
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}

function runDeployGuardScenario(scenario) {
  const directory = mkdtempSync(join(tmpdir(), 'baci-deploy-guards-'));
  const binDirectory = join(directory, 'bin');
  const rsyncMarker = join(directory, 'rsync-called');
  const sshMarker = join(directory, 'ssh-called');
  const promotionMarker = join(directory, 'promotion-called');

  try {
    mkdirSync(binDirectory);
    writeExecutable(
      join(binDirectory, 'git'),
      `#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  "rev-parse HEAD")
    echo "0123456789abcdef0123456789abcdef01234567"
    ;;
  "diff --quiet")
    [ "\${TEST_SCENARIO:-}" != "dirty-tracked" ]
    ;;
  "diff --cached --quiet")
    [ "\${TEST_SCENARIO:-}" != "dirty-staged" ]
    ;;
  "ls-files --others --exclude-standard")
    if [ "\${TEST_SCENARIO:-}" = "dirty-untracked" ]; then
      echo "untracked-file"
    fi
    ;;
  *)
    exit 0
    ;;
esac
`
    );
    writeExecutable(
      join(binDirectory, 'gh'),
      `#!/usr/bin/env bash
# deploy.sh refuses promotion while a production run is in flight;
# the harness owns this answer so no test depends on the network.
if [ "\${TEST_SCENARIO:-}" = "inflight-deploy" ]; then
  echo '184400111 in_progress abc12345 push https://example.invalid/runs/184400111'
fi
exit 0
`
    );
    writeExecutable(
      join(binDirectory, 'rsync'),
      `#!/usr/bin/env bash
touch "\${TEST_RSYNC_MARKER}"
if [ "\${TEST_SCENARIO:-}" = "remote-preflight-failure" ] || [ "\${TEST_SCENARIO:-}" = "missing-remote-env" ] || [ "\${TEST_SCENARIO:-}" = "docker-build-failure" ]; then
  exit 0
fi
exit 73
`
    );
    writeExecutable(
      join(binDirectory, 'ssh'),
      `#!/usr/bin/env bash
touch "\${TEST_SSH_MARKER}"
if [ "\${TEST_SCENARIO:-}" = "remote-preflight-failure" ]; then
  payload="$(cat)"
  case "$* $payload" in
    *"command -v node"*)
      echo /usr/bin/node
      exit 0
      ;;
    *"preflight-direct-web-workers.mjs"*)
      exit 74
      ;;
    *"rsync -a --delete"*)
      touch "\${TEST_PROMOTION_MARKER}"
      exit 0
      ;;
    *)
      exit 0
      ;;
  esac
fi
if [ "\${TEST_SCENARIO:-}" = "missing-remote-env" ]; then
  case "$*" in
    *"test -f"*)
      exit 75
      ;;
    *)
      exit 0
      ;;
  esac
fi
if [ "\${TEST_SCENARIO:-}" = "docker-build-failure" ]; then
  payload="$(cat)"
  case "$* $payload" in
    *"command -v node"*)
      echo /usr/bin/node
      ;;
    *"find /home/bassey/.local"*)
      echo /opt/codex/bin/codex
      ;;
    *"docker build"*)
      exit 76
      ;;
    *"rsync -a --delete"*)
      touch "\${TEST_PROMOTION_MARKER}"
      ;;
  esac
  exit 0
fi
exit 74
`
    );

    const result = spawnSync('bash', [deployScript], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDirectory}:${process.env.PATH ?? ''}`,
        TEST_RSYNC_MARKER: rsyncMarker,
        TEST_PROMOTION_MARKER: promotionMarker,
        TEST_SCENARIO: scenario,
        TEST_SSH_MARKER: sshMarker,
      },
    });

    return {
      result,
      rsyncCalled: existsSync(rsyncMarker),
      sshCalled: existsSync(sshMarker),
      promotionCalled: existsSync(promotionMarker),
    };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

describe('deploy source guards', () => {
  for (const scenario of ['dirty-tracked', 'dirty-staged', 'dirty-untracked']) {
    it(`rejects ${scenario} source before rsync or SSH`, () => {
      const outcome = runDeployGuardScenario(scenario);

      assert.equal(outcome.result.status, 1);
      assert.match(
        outcome.result.stderr,
        /Refusing worker deployment (from a dirty tracked checkout|with untracked files)/
      );
      assert.equal(outcome.rsyncCalled, false);
      assert.equal(outcome.sshCalled, false);
    });
  }

  it('allows clean source to reach the worker sync step', () => {
    const outcome = runDeployGuardScenario('clean');

    assert.equal(outcome.result.status, 73);
    assert.equal(outcome.rsyncCalled, true);
    assert.equal(outcome.sshCalled, true);
  });

  it('refuses clean source while a production deploy is in flight', () => {
    const outcome = runDeployGuardScenario('inflight-deploy');

    assert.equal(outcome.result.status, 1);
    assert.match(outcome.result.stderr, /Refusing worker promotion/);
    assert.match(outcome.result.stderr, /184400111/);
    assert.equal(outcome.rsyncCalled, false);
    assert.equal(outcome.sshCalled, false);
  });

  it('does not replace live workers when the staged preflight fails', () => {
    const outcome = runDeployGuardScenario('remote-preflight-failure');

    assert.equal(outcome.result.status, 1);
    assert.match(outcome.result.stderr, /live worker files.*not changed/);
    assert.equal(outcome.rsyncCalled, true);
    assert.equal(outcome.sshCalled, true);
    assert.equal(outcome.promotionCalled, false);
  });

  it('fails with an actionable message when the remote environment is missing', () => {
    const outcome = runDeployGuardScenario('missing-remote-env');

    assert.equal(outcome.result.status, 1);
    assert.match(outcome.result.stderr, /Missing .*\.env; create it before/);
    assert.equal(outcome.rsyncCalled, true);
    assert.equal(outcome.promotionCalled, false);
  });

  it('does not replace live workers when the remediator image build fails', () => {
    const outcome = runDeployGuardScenario('docker-build-failure');

    assert.equal(outcome.result.status, 76);
    assert.equal(outcome.rsyncCalled, true);
    assert.equal(outcome.sshCalled, true);
    assert.equal(outcome.promotionCalled, false);
  });

  // The GIGL exit-42 deferral scenarios live in
  // deploy-gigl-42-deferral.test.mjs (extracted to keep both suites under
  // the 300-line limit).

  // Promotion locking/quiesce coverage lives in
  // deploy-promotion-guards.test.mjs (extracted to keep both suites
  // under the 300-line limit).

  it('provisions the immutable checkout before smoking it', () => {
    const source = readFileSync(releaseHelper, 'utf8');

    assert.match(
      source,
      /lib\/provision-immutable-checkout\.sh' '\$STAGING_DIR' '\$APP_SHA'/
    );
    assert.ok(
      source.indexOf('provision-immutable-checkout.sh') <
        source.indexOf('Verifying the live GIGL database capability')
    );
  });

  it('validates the direct worker toolchain without allowing pnpm to mutate it', () => {
    const provisioner = readFileSync(
      join(workerRoot, 'lib', 'provision-immutable-checkout.sh'),
      'utf8'
    );

    assert.match(
      provisioner,
      /tsx_bin="\$repo_dir\/apps\/web\/node_modules\/\.bin\/tsx"/
    );
    assert.match(provisioner, /tsx_bin="\$repo_dir\/node_modules\/\.bin\/tsx"/);
    assert.doesNotMatch(provisioner, /pnpm .*exec tsx/);
    assert.match(provisioner, /worktree add --detach/);
    assert.match(provisioner, /pnpm install --frozen-lockfile/);
  });
});

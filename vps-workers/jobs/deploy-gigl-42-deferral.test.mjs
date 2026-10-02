import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
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

function writeExecutable(path, source) {
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}

// Focused extract from deploy-source-guards.test.mjs: the exit-42
// deferral scenarios need the full deploy.sh harness but not the dirty,
// preflight, or docker stubs, so this file carries a minimal harness
// (clean git, permissive rsync, GIGL-42 ssh) to stay under the 300-line
// limit in both modules.
function runGigl42Scenario(scenario) {
  const directory = mkdtempSync(join(tmpdir(), 'baci-deploy-gigl-42-'));
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
  *)
    exit 0
    ;;
esac
`
    );
    writeExecutable(
      join(binDirectory, 'rsync'),
      `#!/usr/bin/env bash
touch "\${TEST_RSYNC_MARKER}"
exit 0
`
    );
    writeExecutable(
      join(binDirectory, 'ssh'),
      `#!/usr/bin/env bash
touch "\${TEST_SSH_MARKER}"
args="$*"
payload="$(cat)"
# The latch name also appears in the promote payload (rsync exclude),
# so match the smoke and the latch READ on the arguments only.
case "$args" in
  *"verify-gigl-tracking-worker-capability.sh"*)
    exit 42
    ;;
  *".gigl-capability-smoke-ok"*)
    if [ "\${TEST_SCENARIO:-}" = "gigl-42-vacuous-latch" ]; then
      echo "disabled:0123456789abcdef0123456789abcdef01234567:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
      exit 0
    fi
    if [ "\${TEST_SCENARIO:-}" = "gigl-42-proven-latch" ]; then
      echo "enabled:0123456789abcdef0123456789abcdef01234567:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
      exit 0
    fi
    exit 1
    ;;
esac
case "$args $payload" in
  *"command -v node"*)
    echo /usr/bin/node
    ;;
  *"find /home/bassey/.local"*)
    echo /opt/codex/bin/codex
    ;;
  *"rsync -a --delete"*)
    touch "\${TEST_PROMOTION_MARKER}"
    ;;
esac
exit 0
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

describe('deploy GIGL exit-42 deferral', () => {
  it('defers exit-42 capability verification when no latch exists yet', () => {
    const outcome = runGigl42Scenario('gigl-42-no-latch');

    assert.equal(outcome.result.status, 0, outcome.result.stderr);
    assert.match(outcome.result.stderr, /deferring capability verification/);
    assert.equal(outcome.promotionCalled, true);
  });

  it('defers exit-42 when the latch is vacuous (no token ever proved)', () => {
    const outcome = runGigl42Scenario('gigl-42-vacuous-latch');

    assert.equal(outcome.result.status, 0, outcome.result.stderr);
    assert.match(outcome.result.stderr, /deferring capability verification/);
    assert.equal(outcome.promotionCalled, true);
  });

  it('refuses to promote on exit-42 after a smoke proved the worker', () => {
    const outcome = runGigl42Scenario('gigl-42-proven-latch');

    assert.equal(outcome.result.status, 1);
    assert.match(outcome.result.stderr, /refusing to promote/);
    assert.match(
      outcome.result.stderr,
      /remove .*\.gigl-capability-smoke-ok on the VPS and rerun/
    );
    assert.equal(outcome.promotionCalled, false);
  });
});

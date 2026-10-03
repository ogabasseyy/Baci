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
  const fetchMarker = join(directory, 'fetch-called');

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
  # Leading * swallows the -C <repo> prefix (? matches the space:
  # case patterns cannot hold literal spaces).
  *cat-file?-e*)
    if [ "\${TEST_SCENARIO:-}" = "gigl-42-unknown-sha" ]; then
      exit 1
    fi
    # Fetch-then-resolve: the first check fails until the fetch lands.
    if [ "\${TEST_SCENARIO:-}" = "gigl-42-fetch-resolves" ] && [ ! -f "\${TEST_FETCH_MARKER}" ]; then
      exit 1
    fi
    exit 0
    ;;
  *fetch?--quiet?origin?ops/*)
    # Promote-record fetch: not the deferral fetch under test.
    exit 0
    ;;
  *fetch?--quiet?origin*)
    : > "\${TEST_FETCH_MARKER}"
    exit 0
    ;;
  *supabase/migrations/*)
    case "\${TEST_SCENARIO:-}" in
      gigl-42-migration-transition|gigl-42-fetch-resolves)
        printf '%s\\n' \\
          'diff --git a/supabase/migrations/20260806000000_gigl_new_wrapper.sql' \\
          'new file mode 100644' \\
          '--- /dev/null' \\
          '+++ b/supabase/migrations/20260806000000_gigl_new_wrapper.sql' \\
          '@@ -0,0 +1 @@' \\
          '+CREATE OR REPLACE FUNCTION public.gigl_worker_new_probe()'
        ;;
      gigl-42-unrelated-migration)
        # Boundary identifier in the +++ header only: headers prove
        # nothing (added/removed lines only).
        printf '%s\\n' \\
          'diff --git a/supabase/migrations/20260806000001_gigl_worker_comment.sql' \\
          'new file mode 100644' \\
          '--- /dev/null' \\
          '+++ b/supabase/migrations/20260806000001_gigl_worker_comment.sql' \\
          '@@ -0,0 +1 @@' \\
          '+ALTER TABLE public.gigl_tracking_monitors ADD COLUMN note text;'
        ;;
      gigl-42-context-mention)
        printf '%s\\n' \\
          'diff --git a/supabase/migrations/20260806000002_gigl_tweak.sql' \\
          'new file mode 100644' \\
          '--- /dev/null' \\
          '+++ b/supabase/migrations/20260806000002_gigl_tweak.sql' \\
          '@@ -0,0 +1,2 @@' \\
          ' -- keep gigl_worker_claim_due_tracking_monitors untouched' \\
          '+ALTER TABLE public.gigl_tracking_monitors ADD COLUMN note text;'
        ;;
    esac
    exit 0
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
# the harness answers "none" so no test depends on the network.
exit 0
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
    if [ "\${TEST_SCENARIO:-}" = "gigl-42-proven-latch" ] || [ "\${TEST_SCENARIO:-}" = "gigl-42-migration-transition" ] || [ "\${TEST_SCENARIO:-}" = "gigl-42-unknown-sha" ] || [ "\${TEST_SCENARIO:-}" = "gigl-42-unrelated-migration" ] || [ "\${TEST_SCENARIO:-}" = "gigl-42-context-mention" ] || [ "\${TEST_SCENARIO:-}" = "gigl-42-fetch-resolves" ]; then
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
        BACI_DEPLOY_SKIP_INFLIGHT_CHECK: '',
        // The inflight guard fails closed without a resolvable repo;
        // the stub git answers no origin, so pin the override (the
        // stub gh swallows the query and the promote record either
        // way).
        BACI_DEPLOY_WORKFLOW_REPO: 'example-owner/example-repo',
        PATH: `${binDirectory}:${process.env.PATH ?? ''}`,
        TEST_FETCH_MARKER: fetchMarker,
        TEST_RSYNC_MARKER: rsyncMarker,
        TEST_PROMOTION_MARKER: promotionMarker,
        TEST_SCENARIO: scenario,
        TEST_SSH_MARKER: sshMarker,
      },
    });

    return {
      result,
      fetchCalled: existsSync(fetchMarker),
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

  it('defers exit-42 when the candidate changes the capability boundary', () => {
    const outcome = runGigl42Scenario('gigl-42-migration-transition');

    assert.equal(outcome.result.status, 0, outcome.result.stderr);
    assert.match(
      outcome.result.stderr,
      /changes the GIGL worker capability boundary/
    );
    assert.equal(outcome.promotionCalled, true);
    // The latch resolved locally: no fetch was needed.
    assert.equal(outcome.fetchCalled, false);
  });

  it('refuses exit-42 when the latch SHA cannot be resolved', () => {
    const outcome = runGigl42Scenario('gigl-42-unknown-sha');

    assert.equal(outcome.result.status, 1);
    assert.match(outcome.result.stderr, /refusing to promote/);
    assert.equal(outcome.promotionCalled, false);
    // The checkout fetched before refusing (shallow/GC'd clones get
    // one chance to resolve).
    assert.equal(outcome.fetchCalled, true);
  });

  it('refuses exit-42 on unrelated GIGL migrations since the latch', () => {
    const outcome = runGigl42Scenario('gigl-42-unrelated-migration');

    assert.equal(outcome.result.status, 1);
    assert.match(outcome.result.stderr, /refusing to promote/);
    assert.equal(outcome.promotionCalled, false);
  });

  it('refuses exit-42 when the boundary appears in context lines only', () => {
    const outcome = runGigl42Scenario('gigl-42-context-mention');

    assert.equal(outcome.result.status, 1);
    assert.match(outcome.result.stderr, /refusing to promote/);
    assert.equal(outcome.promotionCalled, false);
  });

  it('defers exit-42 when a fetch resolves the latch SHA', () => {
    const outcome = runGigl42Scenario('gigl-42-fetch-resolves');

    assert.equal(outcome.result.status, 0, outcome.result.stderr);
    assert.match(outcome.result.stderr, /deferring capability verification/);
    assert.equal(outcome.promotionCalled, true);
    assert.equal(outcome.fetchCalled, true);
  });
});

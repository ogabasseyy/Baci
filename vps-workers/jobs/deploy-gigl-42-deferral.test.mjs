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
import { gigl42SshStub } from './deploy-gigl-42-deferral.test-fixture.mjs';

const workerRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(workerRoot, '..');
const deployScript = join(workerRoot, 'deploy.sh');

function writeExecutable(path, source) {
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}

// Local command stubs isolate deploy.sh capability-deferral behavior.
// No GitHub, SSH or rsync operation reaches an external system.
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
  *hash-object*--stdin*|*mktree*)
    # Git plumbing consumes its pipe before replying. Exiting early makes
    # the writer fail nondeterministically with SIGPIPE under pipefail.
    cat >/dev/null
    echo "0123456789abcdef0123456789abcdef01234567"
    ;;
  *commit-tree*)
    echo "0123456789abcdef0123456789abcdef01234567"
    ;;
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
    writeExecutable(join(binDirectory, 'ssh'), gigl42SshStub);

    if (scenario.startsWith('plumbing-probe-')) {
      const command = scenario.endsWith('tree')
        ? 'mktree'
        : 'hash-object -w --stdin';
      const result = spawnSync(
        'bash',
        ['-o', 'pipefail', '-c', `printf '%131072s\\n' '' | git ${command}`],
        {
          cwd: directory,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${binDirectory}:${process.env.PATH ?? ''}`,
          },
        }
      );
      return { result };
    }

    const result = spawnSync('bash', [deployScript], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        BACI_DEPLOY_SKIP_INFLIGHT_CHECK: '',
        // Pin a fixture-only repository for the stubbed inflight guard.
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

it('keeps git plumbing stdin open until piped input has been consumed', () => {
  for (const scenario of ['plumbing-probe-tree', 'plumbing-probe-blob']) {
    const { result } = runGigl42Scenario(scenario);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout.trim(), /^[a-f0-9]{40}$/);
  }
});

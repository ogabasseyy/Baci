import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(
  new URL('./preview-deploy-run.sh', import.meta.url),
);
const PREVIEW_URL =
  'https://baci-p4e7k4wyn-basseys-projects-d7395611.vercel.app';

// GNU timeout is absent on macOS runners, so tests prepend a double that
// execs the command and optionally forces the exit status. Real timeout
// kill semantics are GNU/production-proven, not re-tested here.
const FAKE_TIMEOUT = `#!/usr/bin/env bash
while [[ "$1" == -* ]]; do
  case "$1" in -s|-k) shift 2;; *) shift;; esac
done
shift
"$@"
status=$?
if [ -n "\${FAKE_TIMEOUT_EXIT:-}" ]; then exit "$FAKE_TIMEOUT_EXIT"; fi
exit "$status"
`;

function withHarness(callback) {
  const directory = mkdtempSync(join(tmpdir(), 'preview-deploy-run-'));
  const stub = join(directory, 'stub-deploy.sh');
  const outputs = join(directory, 'outputs');
  const summary = join(directory, 'summary.md');
  writeFileSync(join(directory, 'timeout'), FAKE_TIMEOUT, { mode: 0o755 });

  try {
    callback({ cwd: directory, stub, outputs, summary });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function runDeploy({ cwd, stub, outputs, summary }, stubBody, extraEnv = {}) {
  // argv[1] doubles as the CLI runner: the deploy phase invokes the stub
  // argless, while the timeout-path readiness check calls it with
  // `inspect <url>` (FAKE_INSPECT_EXIT defaults to live, inspect JSON
  // defaults to readyState READY; FAKE_INSPECT_STATUS overrides it).
  writeFileSync(
    stub,
    `#!/usr/bin/env bash\nif [ "\${1:-}" = inspect ]; then\ninspect_status="\${FAKE_INSPECT_STATUS:-}"\nif [ -z "$inspect_status" ]; then inspect_status='{"readyState":"READY"}'; fi\nprintf '%s\\n' "$inspect_status"\nexit "\${FAKE_INSPECT_EXIT:-0}"\nfi\n${stubBody}\n`,
    { mode: 0o755 }
  );
  return spawnSync('bash', [SCRIPT, stub], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${cwd}${process.env.PATH ? `:${process.env.PATH}` : ''}`,
      PREVIEW_REF: 'feature/demo',
      GITHUB_OUTPUT: outputs,
      GITHUB_STEP_SUMMARY: summary,
      ...extraEnv,
    },
  });
}

function read(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

test('accepts a clean deploy and publishes the URL output and summary', () => {
  withHarness((harness) => {
    const result = runDeploy(harness, `echo 'Preview: ${PREVIEW_URL}'`);
    assert.equal(result.status, 0, result.stderr);
    assert.match(read(harness.outputs), new RegExp(`preview_url=${PREVIEW_URL}`));
    assert.match(
      read(harness.summary),
      new RegExp(`## Preview ready for \`feature/demo\`: ${PREVIEW_URL}`),
    );
  });
});

test('accepts a captured URL when the CLI hangs after printing it', () => {
  withHarness((harness) => {
    const result = runDeploy(harness, `echo 'Preview: ${PREVIEW_URL}'`, {
      FAKE_TIMEOUT_EXIT: '124',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(read(harness.outputs), new RegExp(`preview_url=${PREVIEW_URL}`));
  });
});

test('fails a hung deploy whose URL does not inspect as live', () => {
  withHarness((harness) => {
    const result = runDeploy(harness, `echo 'Preview: ${PREVIEW_URL}'`, {
      FAKE_TIMEOUT_EXIT: '124',
      FAKE_INSPECT_EXIT: '1',
    });
    assert.equal(result.status, 124);
    assert.match(result.stderr, /did not verify as a Ready deployment/);
    assert.equal(read(harness.outputs), '');
  });
});

test('fails a hung deploy whose inspect exits clean but reports readyState ERROR', () => {
  withHarness((harness) => {
    const result = runDeploy(harness, `echo 'Preview: ${PREVIEW_URL}'`, {
      FAKE_TIMEOUT_EXIT: '124',
      FAKE_INSPECT_EXIT: '0',
      FAKE_INSPECT_STATUS: '{"readyState":"ERROR","id":"dpl_abc"}',
    });
    assert.equal(result.status, 124);
    assert.match(result.stderr, /did not verify as a Ready deployment/);
    assert.equal(read(harness.outputs), '');
  });
});

test('accepts a hung deploy whose inspect reports readyState READY', () => {
  withHarness((harness) => {
    const result = runDeploy(harness, `echo 'Preview: ${PREVIEW_URL}'`, {
      FAKE_TIMEOUT_EXIT: '124',
      FAKE_INSPECT_EXIT: '0',
      FAKE_INSPECT_STATUS: '{\n  "readyState": "READY",\n  "id": "dpl_abc"\n}',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(read(harness.outputs), new RegExp(`preview_url=${PREVIEW_URL}`));
  });
});

test('rejects a failed deploy even when a URL was printed', () => {
  withHarness((harness) => {
    const result = runDeploy(
      harness,
      `echo 'Preview: ${PREVIEW_URL}'; echo finalization-failed >&2; exit 3`,
    );
    assert.equal(result.status, 3);
    assert.equal(read(harness.outputs), '');
  });
});

test('rejects a failed deploy without a URL with the CLI status', () => {
  withHarness((harness) => {
    const result = runDeploy(harness, 'echo boom >&2; exit 3');
    assert.equal(result.status, 3);
    assert.match(result.stderr, /Deploy failed with status 3/);
  });
});

test('exits 124 with dashboard guidance on timeout without a URL', () => {
  withHarness((harness) => {
    const result = runDeploy(harness, 'echo starting', {
      FAKE_TIMEOUT_EXIT: '124',
    });
    assert.equal(result.status, 124);
    assert.match(result.stderr, /Vercel dashboard for an orphaned deployment/);
  });
});

test('exits 1 when a clean run prints no parseable URL', () => {
  withHarness((harness) => {
    const result = runDeploy(harness, 'echo done');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Could not find the Preview URL/);
  });
});

test('keeps a hostile ref to one sanitized summary line', () => {
  withHarness((harness) => {
    const result = runDeploy(harness, `echo 'Preview: ${PREVIEW_URL}'`, {
      PREVIEW_REF: 'feat/x`y\nz\rinjected',
    });
    assert.equal(result.status, 0, result.stderr);
    const summary = read(harness.summary).trim();
    assert.equal(summary.split('\n').length, 1);
    const refSpan = summary.match(/`([^`]*)`/)?.[1] ?? '';
    assert.equal(refSpan, 'feat/xyzinjected');
  });
});

test('ignores off-domain lookalikes containing vercel.app', () => {
  withHarness((harness) => {
    const result = runDeploy(
      harness,
      `echo 'Preview: https://evil.example/x?.vercel.app'; echo 'Preview: ${PREVIEW_URL}'`
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(read(harness.outputs), new RegExp(`preview_url=${PREVIEW_URL}`));
  });
  withHarness((harness) => {
    const result = runDeploy(
      harness,
      `echo 'Preview: https://evil.example/x?.vercel.app'`
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Could not find the Preview URL/);
  });
});

test('rejects vercel.app URLs outside this project namespace', () => {
  withHarness((harness) => {
    const result = runDeploy(
      harness,
      `echo 'Preview: https://other-app.vercel.app'; echo 'Preview: https://baci-evil.vercel.app'; echo 'Preview: ${PREVIEW_URL}'`
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(read(harness.outputs), new RegExp(`preview_url=${PREVIEW_URL}`));
  });
  withHarness((harness) => {
    const result = runDeploy(
      harness,
      `echo 'Preview: https://attacker-site.vercel.app'`
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Could not find the Preview URL/);
  });
});

test('strips trailing quote characters from the captured URL', () => {
  withHarness((harness) => {
    const result = runDeploy(
      harness,
      `echo 'Preview: ${PREVIEW_URL}"'`
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(read(harness.outputs), new RegExp(`preview_url=${PREVIEW_URL}`));
  });
});

test('fails closed when required env or argv is missing', () => {
  withHarness((harness) => {
    const noArgv = spawnSync('bash', [SCRIPT], {
      cwd: harness.cwd,
      encoding: 'utf8',
      env: { ...process.env },
    });
    assert.equal(noArgv.status, 64);
  });
});

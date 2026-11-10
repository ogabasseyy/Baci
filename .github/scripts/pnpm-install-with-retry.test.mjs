import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const scriptPath = new URL('pnpm-install-with-retry.sh', import.meta.url);

function makeFakePnpm({ retryable, error }) {
  const tempDir = mkdtempSync(join(tmpdir(), 'baci-pnpm-retry-'));
  const binDir = join(tempDir, 'bin');
  const errorFile = join(tempDir, 'first-error.log');
  const attemptsFile = join(tempDir, 'attempts');
  const storeDir = join(tempDir, 'store');
  const workspaceDir = join(tempDir, 'workspace');
  const nodeModulesDirs = [
    join(workspaceDir, 'node_modules'),
    join(workspaceDir, 'apps/web/node_modules'),
    join(workspaceDir, 'packages/shared/node_modules'),
  ];

  [binDir, storeDir, ...nodeModulesDirs].forEach((dir) => {
    mkdirSync(dir, { recursive: true });
  });

  const firstError =
    error ??
    (retryable
      ? 'Error: database disk image is malformed\ncode: ERR_SQLITE_ERROR\n'
      : 'Error: non-retryable install failure\n');
  writeFileSync(errorFile, firstError);

  writeFileSync(
    join(binDir, 'pnpm'),
    `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1:-}" = "config" ]; then
  exit 0
fi
if [ "\${1:-}" != "install" ]; then
  echo "unexpected pnpm command: $*" >&2
  exit 64
fi
attempts_file="${attemptsFile}"
attempt=0
if [ -f "$attempts_file" ]; then
  attempt="$(cat "$attempts_file")"
fi
attempt=$((attempt + 1))
echo "$attempt" > "$attempts_file"
if [ "$attempt" -eq 1 ]; then
  cat "${errorFile}" >&2
  exit 1
fi
echo "fake install succeeded"
`,
    { mode: 0o755 }
  );

  return {
    attemptsFile,
    binDir,
    nodeModulesDirs,
    storeDir,
    tempDir,
    workspaceDir,
  };
}

function runScript(fakePnpm) {
  return spawnSync('bash', [scriptPath.pathname, '--frozen-lockfile'], {
    cwd: fakePnpm.workspaceDir,
    env: {
      ...process.env,
      BACKOFF_SECONDS: '0',
      MAX_ATTEMPTS: '2',
      PATH: `${fakePnpm.binDir}:${process.env.PATH ?? ''}`,
      PNPM_STORE_DIR: fakePnpm.storeDir,
    },
    encoding: 'utf8',
  });
}

test('retries after pnpm sqlite store corruption and succeeds', () => {
  const fakePnpm = makeFakePnpm({ retryable: true });

  try {
    const result = runScript(fakePnpm);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Cleaning install artifacts before retry/);
    assert.match(result.stdout, /fake install succeeded/);
    assert.equal(readFileSync(fakePnpm.attemptsFile, 'utf8').trim(), '2');
    fakePnpm.nodeModulesDirs.forEach((dir) => {
      assert.equal(
        existsSync(dir),
        false,
        `Expected ${dir} to be removed after retryable failure`
      );
    });
  } finally {
    rmSync(fakePnpm.tempDir, { recursive: true, force: true });
  }
});

test('retries a transient DNS failure in a package postinstall', () => {
  const fakePnpm = makeFakePnpm({
    error: 'Error fetching release: getaddrinfo EAI_AGAIN github.com\n',
  });
  try {
    const result = runScript(fakePnpm);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(readFileSync(fakePnpm.attemptsFile, 'utf8').trim(), '2');
  } finally {
    rmSync(fakePnpm.tempDir, { recursive: true, force: true });
  }
});

test('retries a gateway timeout fetching a package postinstall release', () => {
  const fakePnpm = makeFakePnpm({
    error:
      'Error fetching release: HTTP 504 from https://github.com/PostHog/posthog/releases/download/posthog-cli/v0.7.34/posthog-cli-x86_64-unknown-linux-gnu.tar.gz\n',
  });
  try {
    const result = runScript(fakePnpm);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(readFileSync(fakePnpm.attemptsFile, 'utf8').trim(), '2');
  } finally {
    rmSync(fakePnpm.tempDir, { recursive: true, force: true });
  }
});

test('does not retry a forbidden package postinstall release', () => {
  const fakePnpm = makeFakePnpm({
    error:
      'Error fetching release: HTTP 403 from https://github.com/PostHog/posthog/releases/download/posthog-cli/v0.7.34/posthog-cli-x86_64-unknown-linux-gnu.tar.gz\n',
  });
  try {
    const result = runScript(fakePnpm);
    assert.equal(result.status, 1);
    assert.equal(readFileSync(fakePnpm.attemptsFile, 'utf8').trim(), '1');
  } finally {
    rmSync(fakePnpm.tempDir, { recursive: true, force: true });
  }
});

test('does not retry unrelated install failures', () => {
  const fakePnpm = makeFakePnpm({ retryable: false });

  try {
    const result = runScript(fakePnpm);

    assert.equal(result.status, 1);
    assert.match(result.stdout, /pnpm install failed after 1 attempt/);
    assert.equal(readFileSync(fakePnpm.attemptsFile, 'utf8').trim(), '1');
    fakePnpm.nodeModulesDirs.forEach((dir) => {
      assert.equal(
        existsSync(dir),
        true,
        `Expected ${dir} to be preserved after non-retryable failure`
      );
    });
  } finally {
    rmSync(fakePnpm.tempDir, { recursive: true, force: true });
  }
});

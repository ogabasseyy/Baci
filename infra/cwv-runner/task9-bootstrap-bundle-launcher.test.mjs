import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runTask9BootstrapBundleLauncher } from './task9-bootstrap-bundle-launcher.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const checkout = join(root, '../..');
const composerPath = join(root, 'task9-bootstrap-bundle-cli.mjs');
const composerSha256 = createHash('sha256')
  .update(readFileSync(composerPath))
  .digest('hex');
const githubPath = '/usr/bin/true';
const githubSha256 = createHash('sha256')
  .update(readFileSync(githubPath))
  .digest('hex');
const invocation = {
  composerPath,
  composerSha256,
  githubPath,
  githubSha256,
  argv: [],
  cwd: checkout,
};

test('rejects a modified composer before importing it', async () => {
  await assert.rejects(
    runTask9BootstrapBundleLauncher({
      ...invocation,
      composerSha256: '0'.repeat(64),
    }),
    /invalid Task 9 composer/
  );
});

test('hash-checks the composer before invoking its closed CLI', async () => {
  await assert.rejects(
    runTask9BootstrapBundleLauncher(invocation),
    /invalid Task 9 bundle invocation/
  );
});

test('accepts the canonical composer when the launcher is relocated', async () => {
  await assert.rejects(
    runTask9BootstrapBundleLauncher(invocation),
    /invalid Task 9 bundle invocation/
  );
});

test('refuses a modified dependency even when the CLI hash still matches', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'task9-launcher-closure-'));
  try {
    copyFileSync(
      composerPath,
      join(directory, 'task9-bootstrap-bundle-cli.mjs')
    );
    writeFileSync(
      join(directory, 'canonical-json.mjs'),
      'export const canonicalJson=()=>"forged";'
    );
    await assert.rejects(
      runTask9BootstrapBundleLauncher({
        ...invocation,
        composerPath: join(directory, 'task9-bootstrap-bundle-cli.mjs'),
      }),
      /invalid Task 9 composer/
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('refuses a FIFO GitHub executable without blocking', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'task9-launcher-github-fifo-'));
  const fifo = join(directory, 'gh');
  try {
    execFileSync('/usr/bin/mkfifo', ['-m', '500', fifo]);
    await assert.rejects(
      runTask9BootstrapBundleLauncher({
        ...invocation,
        githubPath: fifo,
        githubSha256: '0'.repeat(64),
      }),
      /invalid Task 9 composer/
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('bounds live GitHub verification calls', () => {
  assert.match(
    readFileSync(
      new URL('./task9-bootstrap-bundle-launcher.mjs', import.meta.url),
      'utf8'
    ),
    /execFileSync\(github, \['api', endpoint\], \{[\s\S]*timeout: 120_000/
  );
});

test('direct launcher invocation refuses an incomplete closed invocation', async () => {
  const { spawnSync } = await import('node:child_process');
  const launcher = fileURLToPath(
    new URL('./task9-bootstrap-bundle-launcher.mjs', import.meta.url)
  );
  const result = spawnSync(process.execPath, [launcher], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.equal(result.stderr, 'task9-bootstrap-bundle-launcher refused\n');
});

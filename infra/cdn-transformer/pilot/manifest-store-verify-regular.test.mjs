import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertTierBytes } from './manifest-store-verify.mjs';

test('assertTierBytes rejects FIFO entries instead of blocking on them', async () => {
  // mkfifo exists only on POSIX; the loader guard itself is portable.
  if (process.platform === 'win32') {
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), 'pilot-verify-fifo-'));
  const fifo = join(dir, 'tier-w800-q70.avif');
  execFileSync('mkfifo', [fifo]);
  const tiers = [
    {
      bytes: 10,
      path: 'tier-w800-q70.avif',
      sha256: '0'.repeat(64),
    },
  ];
  // Both precommit passes share the guard: staged paths before the
  // move, commit paths before the visibility rename. Either FIFO
  // would block the bounded reader past deadline interruption.
  await assert.rejects(
    () => assertTierBytes(tiers, (name) => join(dir, name), 'staged'),
    /not a regular file/
  );
  await assert.rejects(
    () => assertTierBytes(tiers, (name) => join(dir, name), 'commit'),
    /not a regular file/
  );
  await rm(fifo);
});

test('assertTierBytes still verifies regular staged tiers', async () => {
  const { createHash } = await import('node:crypto');
  const dir = await mkdtemp(join(tmpdir(), 'pilot-verify-regular-'));
  const bytes = Buffer.from('tier-bytes');
  await writeFile(join(dir, 'tier-w800-q70.avif'), bytes);
  const tiers = [
    {
      bytes: bytes.length,
      path: 'tier-w800-q70.avif',
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  ];
  await assert.doesNotReject(() =>
    assertTierBytes(tiers, (name) => join(dir, name), 'staged')
  );
});

import fs from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { GuestCartStorageUnavailableError } from './guest-cart-writer-lock-errors';

// vi.mock('node:fs') does not reach project modules in this repo's runner
// (dual module instances), so the write failure is injected by swapping the
// mutable CJS export before the lock module is first imported: the ESM
// named binding links to the swapped value at instantiation.
async function lockModuleWithFailingWrites() {
  const real = fs.writeSync;
  (fs as Record<string, unknown>).writeSync = () => {
    throw Object.assign(new Error('ENOSPC: no space left on device'), {
      code: 'ENOSPC',
    });
  };
  try {
    return await import('./guest-cart-writer-lock');
  } finally {
    (fs as Record<string, unknown>).writeSync = real;
  }
}

const directories: string[] = [];
afterEach(async () => {
  const { releaseWriterLocks } = await import('./guest-cart-writer-lock');
  releaseWriterLocks();
  await Promise.all(
    directories
      .splice(0)
      .map((created) => rm(created, { recursive: true, force: true }))
  );
});

it('degrades instead of crashing when the lock claim cannot be written', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'guest-lock-claim-'));
  directories.push(root);
  const { acquireWriterLock } = await lockModuleWithFailingWrites();
  // The raw ENOSPC surfaces as the typed outage the store factory
  // catches: catalog tools stay up while guest carts degrade.
  expect(() => acquireWriterLock(root)).toThrow(
    GuestCartStorageUnavailableError
  );
  // No empty lock is left behind to refuse later startups.
  await expect(
    readFile(path.join(root, '.writer.lock'), 'utf8')
  ).rejects.toThrow(/ENOENT/);
  const { createGuestCartStoreOrDegraded } = await import(
    './guest-cart-store'
  );
  expect(createGuestCartStoreOrDegraded(root).degraded).toBe(true);
});

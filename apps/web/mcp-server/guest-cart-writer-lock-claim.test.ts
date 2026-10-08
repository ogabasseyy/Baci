import fs from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { GuestCartStorageUnavailableError } from './guest-cart-writer-lock-errors';

// vi.mock('node:fs') does not reach project modules in this repo's runner
// (dual module instances), so storage failures are injected by swapping
// the mutable CJS exports before the lock module is first imported: the
// ESM named bindings link to the swapped closures at instantiation, and
// the gates arm each failure per test.
const gates = { failWrites: false, failOpens: false, failMkdirs: false };
function storageExhausted(): never {
  throw Object.assign(new Error('ENOSPC: no space left on device'), {
    code: 'ENOSPC',
  });
}
let cached: typeof import('./guest-cart-writer-lock') | undefined;
async function lockModule() {
  if (!cached) {
    const real = {
      writeSync: fs.writeSync,
      openSync: fs.openSync,
      mkdirSync: fs.mkdirSync,
    };
    const mutable = fs as Record<string, unknown>;
    mutable.writeSync = (...args: unknown[]) =>
      gates.failWrites
        ? storageExhausted()
        : (real.writeSync as (...inner: unknown[]) => unknown)(...args);
    mutable.openSync = (...args: unknown[]) =>
      gates.failOpens
        ? storageExhausted()
        : (real.openSync as (...inner: unknown[]) => unknown)(...args);
    mutable.mkdirSync = (...args: unknown[]) =>
      gates.failMkdirs
        ? storageExhausted()
        : (real.mkdirSync as (...inner: unknown[]) => unknown)(...args);
    try {
      cached = await import('./guest-cart-writer-lock');
    } finally {
      mutable.writeSync = real.writeSync;
      mutable.openSync = real.openSync;
      mutable.mkdirSync = real.mkdirSync;
    }
  }
  return cached;
}

const directories: string[] = [];
beforeEach(() => {
  gates.failWrites = false;
  gates.failOpens = false;
  gates.failMkdirs = false;
});
afterEach(async () => {
  const { releaseWriterLocks } = await lockModule();
  releaseWriterLocks();
  await Promise.all(
    directories
      .splice(0)
      .map((created) => rm(created, { recursive: true, force: true }))
  );
});
async function freshDirectory() {
  const root = await mkdtemp(path.join(tmpdir(), 'guest-lock-claim-'));
  directories.push(root);
  return root;
}

it('degrades instead of crashing when the lock claim cannot be written', async () => {
  const root = await freshDirectory();
  const { acquireWriterLock } = await lockModule();
  gates.failWrites = true;
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

it('degrades when opening the claim exhausts storage', async () => {
  const root = await freshDirectory();
  const { acquireWriterLock } = await lockModule();
  gates.failOpens = true;
  // A volume already at its block, inode, or quota limit throws before
  // any descriptor exists for the write path to map: the open must map
  // it too, or the server restart-loops instead of degrading.
  expect(() => acquireWriterLock(root)).toThrow(
    GuestCartStorageUnavailableError
  );
  await expect(
    readFile(path.join(root, '.writer.lock'), 'utf8')
  ).rejects.toThrow(/ENOENT/);
});

it('degrades when creating the directory exhausts storage', async () => {
  const root = await freshDirectory();
  const { acquireWriterLock } = await lockModule();
  gates.failMkdirs = true;
  expect(() => acquireWriterLock(root)).toThrow(
    GuestCartStorageUnavailableError
  );
});

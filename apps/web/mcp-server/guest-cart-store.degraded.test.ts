import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  GuestCartStore,
  createGuestCartStoreOrDegraded,
} from './guest-cart-store';
import { releaseWriterLocks } from './guest-cart-writer-lock';
import { GuestCartStorageUnavailableError } from './guest-cart-writer-lock-errors';

const directories: string[] = [];
async function directory(prefix: string) {
  const created = await mkdtemp(path.join(tmpdir(), prefix));
  directories.push(created);
  return created;
}
afterEach(async () => {
  releaseWriterLocks();
  await Promise.all(
    directories
      .splice(0)
      .map((created) => rm(created, { recursive: true, force: true }))
  );
});

it('builds a live store when storage is healthy', async () => {
  const root = await directory('guest-degraded-live-');
  const store = createGuestCartStoreOrDegraded(root);
  expect(store).toBeInstanceOf(GuestCartStore);
  expect(await store.hasToken('0'.repeat(64))).toBe(false);
});

it('still refuses a second writer instead of degrading', async () => {
  const root = await directory('guest-degraded-refuse-');
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await writeFile(
      path.join(root, '.writer.lock'),
      JSON.stringify({ pid: 99999999, startedAt: new Date().toISOString() })
    );
    expect(() => createGuestCartStoreOrDegraded(root)).toThrow(
      /Another MCP writer owns/
    );
  } finally {
    error.mockRestore();
  }
});

it('degrades the tool when cart storage is misconfigured', async () => {
  // Root bypasses permission bits, so the probe is meaningless there.
  if (typeof process.getuid === 'function' && process.getuid() === 0) return;
  const parent = await directory('guest-degraded-perms-');
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await chmod(parent, 0o555);
    const store = createGuestCartStoreOrDegraded(path.join(parent, 'carts'));
    expect(store).not.toBeInstanceOf(GuestCartStore);
    expect(await store.hasToken('0'.repeat(64))).toBe(false);
    await expect(
      store.update(undefined, {
        product_id: '11111111-1111-4111-8111-111111111111',
        quantity: 1,
      }, async () => {})
    ).rejects.toBeInstanceOf(GuestCartStorageUnavailableError);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('degraded'));
  } finally {
    error.mockRestore();
    await chmod(parent, 0o755);
  }
});

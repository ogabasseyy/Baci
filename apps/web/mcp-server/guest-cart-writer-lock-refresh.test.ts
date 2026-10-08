import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

// Ownership only needs a readable claim, but utimes needs more than the
// owner-readable bits a chmod probe can express (an owner may refresh a
// 0444 file), so the refresh failure is injected like the claim test
// does: swap the mutable CJS export before the lock module is first
// imported, and the ESM named binding links to the swapped value.
async function lockModuleWithFailingRefresh() {
  const real = fs.utimesSync;
  (fs as Record<string, unknown>).utimesSync = () => {
    throw Object.assign(new Error('EROFS: read-only file system'), {
      code: 'EROFS',
    });
  };
  try {
    return await import('./guest-cart-writer-lock');
  } finally {
    (fs as Record<string, unknown>).utimesSync = real;
  }
}

const directories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  const { releaseWriterLocks } = await import('./guest-cart-writer-lock');
  releaseWriterLocks();
  await Promise.all(
    directories
      .splice(0)
      .map((created) => rm(created, { recursive: true, force: true }))
  );
});

it('exits instead of serving when the heartbeat cannot refresh', async () => {
  vi.useFakeTimers();
  const exit = vi
    .spyOn(process, 'exit')
    .mockImplementation((() => undefined) as never);
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const root = await mkdtemp(path.join(tmpdir(), 'guest-lock-refresh-'));
  directories.push(root);
  try {
    const { acquireWriterLock } = await lockModuleWithFailingRefresh();
    acquireWriterLock(root);
    // The claim is intact and readable (ownership verifies), but the
    // refresh cannot land: without fail-closed the mtime would go stale
    // and invite takeover while this process keeps writing.
    await vi.advanceTimersByTimeAsync(6000);
    expect(exit).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('single-writer guarantee')
    );
  } finally {
    exit.mockRestore();
    error.mockRestore();
  }
});

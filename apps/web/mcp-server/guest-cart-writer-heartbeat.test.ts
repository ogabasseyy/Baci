import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  type OwnedLock,
  startWriterHeartbeat,
} from './guest-cart-writer-heartbeat';

const directories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(
    directories
      .splice(0)
      .map((created) => rm(created, { recursive: true, force: true }))
  );
});

async function ownedClaim() {
  const root = await mkdtemp(path.join(tmpdir(), 'guest-heartbeat-'));
  directories.push(root);
  const lockPath = path.join(root, '.writer.lock');
  const content = JSON.stringify({ pid: process.pid, startedAt: 't' });
  await writeFile(lockPath, content);
  const identity = await stat(lockPath);
  const owned: OwnedLock = {
    lockPath,
    content,
    dev: identity.dev,
    ino: identity.ino,
    heartbeat: undefined as unknown as NodeJS.Timeout,
  };
  return { lockPath, owned };
}

it('refreshes the claim mtime on each tick', async () => {
  vi.useFakeTimers();
  const { lockPath, owned } = await ownedClaim();
  const before = (await stat(lockPath)).mtimeMs;
  startWriterHeartbeat(lockPath, owned, () => {});
  await vi.advanceTimersByTimeAsync(6000);
  expect((await stat(lockPath)).mtimeMs).toBeGreaterThan(before);
  clearInterval(owned.heartbeat);
});

it('releases and exits when another writer takes over', async () => {
  vi.useFakeTimers();
  const exit = vi
    .spyOn(process, 'exit')
    .mockImplementation((() => undefined) as never);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const release = vi.fn();
  const { lockPath, owned } = await ownedClaim();
  startWriterHeartbeat(lockPath, owned, release);
  await writeFile(lockPath, JSON.stringify({ pid: 424242 }));
  await vi.advanceTimersByTimeAsync(6000);
  expect(release).toHaveBeenCalledTimes(1);
  expect(exit).toHaveBeenCalledWith(1);
  // The takeover path must not remove the replacement's claim file.
  await expect(readFile(lockPath, 'utf8')).resolves.toContain('424242');
  expect(release.mock.invocationCallOrder[0]).toBeLessThan(
    exit.mock.invocationCallOrder[0]
  );
});

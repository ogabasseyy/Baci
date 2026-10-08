import { spawn } from 'node:child_process';
import {
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import {
  acquireWriterLock,
  releaseWriterLocks,
} from './guest-cart-writer-lock';

const directories: string[] = [];
async function directory(prefix: string) {
  const created = await mkdtemp(path.join(tmpdir(), prefix));
  directories.push(created);
  return created;
}
afterEach(async () => {
  vi.useRealTimers();
  // Release locks before deleting their directories: an armed heartbeat
  // observing a missing lock file would fail closed with process.exit.
  releaseWriterLocks();
  await Promise.all(
    directories
      .splice(0)
      .map((created) => rm(created, { recursive: true, force: true }))
  );
});

it('exits when the lock file is replaced even with identical content', async () => {
  vi.useFakeTimers();
  const exit = vi
    .spyOn(process, 'exit')
    .mockImplementation((() => undefined) as never);
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const root = await directory('guest-lock-replaced-');
  try {
    acquireWriterLock(root);
    const lock = path.join(root, '.writer.lock');
    // A takeover installs a new inode: atomically replace the file with the
    // same claim bytes, so a content-only check would keep refreshing it.
    const content = await readFile(lock, 'utf8');
    await writeFile(`${lock}.thief.tmp`, content);
    await rename(`${lock}.thief.tmp`, lock);
    await vi.advanceTimersByTimeAsync(6000);
    expect(exit).toHaveBeenCalledWith(1);
  } finally {
    vi.useRealTimers();
    exit.mockRestore();
    error.mockRestore();
  }
});

it('never refreshes a lock file it does not own', async () => {
  vi.useFakeTimers();
  const exit = vi
    .spyOn(process, 'exit')
    .mockImplementation((() => undefined) as never);
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const root = await directory('guest-lock-no-refresh-');
  try {
    acquireWriterLock(root);
    const lock = path.join(root, '.writer.lock');
    const thief = JSON.stringify({ pid: 424242, startedAt: '2026-01-01' });
    await writeFile(`${lock}.thief.tmp`, thief);
    await rename(`${lock}.thief.tmp`, lock);
    const old = new Date(Date.now() - 60_000);
    await utimes(lock, old, old);
    // Compare filesystem timestamps with each other, not with the set
    // value: recent millisecond timestamps lose precision in the ms-to-ns
    // conversion, so a round-tripped stat may differ in the low bits.
    const before = (await stat(lock)).mtimeMs;
    await vi.advanceTimersByTimeAsync(6000);
    expect(exit).toHaveBeenCalledWith(1);
    expect((await stat(lock)).mtimeMs).toBe(before);
  } finally {
    vi.useRealTimers();
    exit.mockRestore();
    error.mockRestore();
  }
});

it(
  'exits under cross-process same-content replacement pressure',
  { timeout: 20000 },
  async () => {
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const root = await directory('guest-lock-churn-');
    const lock = path.join(root, '.writer.lock');
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.dirname(path.dirname(path.dirname(moduleDir)));
    const tsxExecutable = path.join(
      repoRoot,
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'tsx.cmd' : 'tsx'
    );
    // A rival writer atomically reinstalls our own claim bytes in a tight
    // loop, so replacements land across the heartbeat's read and refresh:
    // renewal must still detect the new generation and exit on the tick.
    const childScript = path.join(root, 'churn-child.mts');
    try {
      acquireWriterLock(root);
      const content = await readFile(lock, 'utf8');
      await writeFile(
        childScript,
        `import { renameSync, writeFileSync } from 'node:fs';
const [, , lockPath, claim, sidePath] = process.argv;
const deadline = Date.now() + 9000;
while (Date.now() < deadline) {
  writeFileSync(sidePath, claim);
  renameSync(sidePath, lockPath);
}`
      );
      const child = spawn(
        tsxExecutable,
        [childScript, lock, content, `${lock}.churn.tmp`],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );
      // A failed spawn must fail the exit assertion below, not crash the
      // runner with an unhandled 'error' event.
      child.on('error', () => {});
      try {
        await new Promise((resolve) => setTimeout(resolve, 6500));
        expect(exit).toHaveBeenCalledWith(1);
      } finally {
        child.kill();
        await new Promise((resolve) => child.on('close', resolve));
      }
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }
  }
);

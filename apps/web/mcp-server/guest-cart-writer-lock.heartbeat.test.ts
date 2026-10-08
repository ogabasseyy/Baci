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
  { timeout: 40000 },
  async () => {
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const root = await directory('guest-lock-churn-');
    const lock = path.join(root, '.writer.lock');
    // A rival writer atomically reinstalls our own claim bytes in a tight
    // loop, so replacements land across the heartbeat's read and refresh:
    // renewal must still detect the new generation and exit on the tick.
    // Plain node (not tsx) keeps child startup fast, and the child signals
    // readiness so the wait below never starts before churn is running no
    // matter how slow the spawn is under CI load.
    const childScript = path.join(root, 'churn-child.mjs');
    try {
      acquireWriterLock(root);
      const content = await readFile(lock, 'utf8');
      await writeFile(
        childScript,
        `import { renameSync, writeFileSync } from 'node:fs';
const [, , lockPath, claim, sidePath] = process.argv;
process.stdout.write('ready\\n');
const deadline = Date.now() + 25000;
while (Date.now() < deadline) {
  writeFileSync(sidePath, claim);
  renameSync(sidePath, lockPath);
}`
      );
      const child = spawn(
        process.execPath,
        [childScript, lock, content, `${lock}.churn.tmp`],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );
      // A failed spawn must fail the exit assertion below, not crash the
      // runner with an unhandled 'error' event.
      child.on('error', () => {});
      // Track closure from spawn on: awaiting 'close' in the finally below
      // would hang forever if the child already exited before we listened.
      let closed = false;
      child.on('close', () => {
        closed = true;
      });
      let churnReady!: () => void;
      const ready = new Promise<void>((resolve) => {
        churnReady = resolve;
      });
      child.stdout?.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('ready')) churnReady();
      });
      try {
        // Wait for churn to be running (not merely spawned), then poll for
        // the heartbeat exit: a loaded CI worker can delay the spawn or a
        // tick past any fixed budget, while a replaced lock file stays
        // detectable on every later tick.
        const startTimeout = new Promise<never>((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error('churn child never started')),
            10_000
          );
          void ready.then(() => clearTimeout(timer));
        });
        await Promise.race([ready, startTimeout]);
        const deadline = Date.now() + 20_000;
        while (exit.mock.calls.length === 0 && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        expect(exit).toHaveBeenCalledWith(1);
      } finally {
        // Default SIGTERM disposition kills even a child stuck in a sync
        // loop; skip the close wait if it already exited.
        child.kill();
        if (!closed) await new Promise((resolve) => child.on('close', resolve));
      }
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }
  }
);

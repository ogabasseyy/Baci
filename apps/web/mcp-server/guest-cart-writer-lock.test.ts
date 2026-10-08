import {
  chmod,
  mkdtemp,
  readFile,
  rm,
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
  await Promise.all(
    directories
      .splice(0)
      .map((created) => rm(created, { recursive: true, force: true }))
  );
});

it('refuses a second writer while a live lock is held', async () => {
  const root = await directory('guest-lock-live-');
  const logged: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args.map(String).join(' '));
  };
  try {
    await writeFile(
      path.join(root, '.writer.lock'),
      JSON.stringify({ pid: 99999999, startedAt: new Date().toISOString() })
    );
    expect(() => acquireWriterLock(root)).toThrow(/Another MCP writer owns/);
    expect(logged.join('\n')).toContain('.writer.lock');
    expect(logged.join('\n')).toContain('99999999');
    expect(logged.join('\n')).toContain(`pid ${process.pid}`);
  } finally {
    console.error = originalError;
  }
});

it('takes over a stale writer lock', async () => {
  const root = await directory('guest-lock-stale-');
  const lock = path.join(root, '.writer.lock');
  await writeFile(lock, '{}');
  const old = new Date(Date.now() - 60_000);
  await utimes(lock, old, old);
  expect(() => acquireWriterLock(root)).not.toThrow();
  await expect(readFile(lock, 'utf8')).resolves.toContain(
    `"pid":${process.pid}`
  );
});

it('allows reentrant acquisition in the same process', async () => {
  const root = await directory('guest-lock-reentrant-');
  acquireWriterLock(root);
  expect(() => acquireWriterLock(root)).not.toThrow();
});

it('refuses an unwritable directory with remediation instead of a raw errno', async () => {
  // Root bypasses permission bits, so the probe is meaningless there.
  if (typeof process.getuid === 'function' && process.getuid() === 0) return;
  const root = await directory('guest-lock-perms-');
  try {
    await chmod(root, 0o555);
    expect(() => acquireWriterLock(root)).toThrow(
      /not writable.*chown the mounted directory/
    );
  } finally {
    await chmod(root, 0o755);
  }
});

it('exits instead of refreshing a lock lost to takeover', async () => {
  vi.useFakeTimers();
  const exit = vi
    .spyOn(process, 'exit')
    .mockImplementation((() => undefined) as never);
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const root = await directory('guest-lock-takeover-');
  try {
    acquireWriterLock(root);
    await writeFile(
      path.join(root, '.writer.lock'),
      JSON.stringify({ pid: 424242, startedAt: new Date().toISOString() })
    );
    await vi.advanceTimersByTimeAsync(6000);
    expect(exit).toHaveBeenCalledWith(1);
    exit.mockClear();
    await vi.advanceTimersByTimeAsync(30000);
    expect(exit).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
    exit.mockRestore();
    error.mockRestore();
  }
});

it('releases owned locks on shutdown and spares taken-over ones', async () => {
  const first = await directory('guest-lock-release-a-');
  const second = await directory('guest-lock-release-b-');
  acquireWriterLock(first);
  acquireWriterLock(second);
  await writeFile(
    path.join(second, '.writer.lock'),
    JSON.stringify({ pid: 424242, startedAt: new Date().toISOString() })
  );
  releaseWriterLocks();
  await expect(
    readFile(path.join(first, '.writer.lock'), 'utf8')
  ).rejects.toThrow();
  await expect(
    readFile(path.join(second, '.writer.lock'), 'utf8')
  ).resolves.toContain('424242');
  acquireWriterLock(first);
  await expect(
    readFile(path.join(first, '.writer.lock'), 'utf8')
  ).resolves.toContain(`"pid":${process.pid}`);
});

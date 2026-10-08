import { spawn } from 'node:child_process';
import {
  chmod,
  mkdtemp,
  readFile,
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
  await writeFile(lock, JSON.stringify({ pid: 99999999 }));
  const old = new Date(Date.now() - 60_000);
  await utimes(lock, old, old);
  expect(() => acquireWriterLock(root)).not.toThrow();
  await expect(readFile(lock, 'utf8')).resolves.toContain(
    `"pid":${process.pid}`
  );
});

it('refuses a stale lock whose holder is still alive', async () => {
  const root = await directory('guest-lock-suspended-');
  const lock = path.join(root, '.writer.lock');
  await writeFile(lock, JSON.stringify({ pid: process.pid }));
  const old = new Date(Date.now() - 60_000);
  await utimes(lock, old, old);
  expect(() => acquireWriterLock(root)).toThrow(/Another MCP writer owns/);
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
  const parent = await directory('guest-lock-perms-');
  try {
    await chmod(parent, 0o555);
    expect(() => acquireWriterLock(path.join(parent, 'carts'))).toThrow(
      /not writable.*chown the mounted directory/
    );
  } finally {
    await chmod(parent, 0o755);
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

it('creates the cart directory with owner-only permissions', async () => {
  const root = path.join(
    await directory('guest-lock-mode-'),
    'nested',
    'carts'
  );
  acquireWriterLock(root);
  expect((await stat(root)).mode & 0o777).toBe(0o700);
});

it('restricts a pre-existing world-readable directory to owner-only', async () => {
  if (process.platform === 'win32') return;
  const root = await directory('guest-lock-chmod-');
  await chmod(root, 0o755);
  acquireWriterLock(root);
  expect((await stat(root)).mode & 0o777).toBe(0o700);
});

it('elects exactly one owner when two processes race for a fresh lock', async () => {
  const root = await directory('guest-lock-race-');
  const lock = path.join(root, '.writer.lock');
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.dirname(path.dirname(path.dirname(moduleDir)));
  const tsxExecutable = path.join(
    repoRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx'
  );
  // The winner stays alive past the race: after a real exit any takeover
  // is legitimate, so exiting racers cannot assert single ownership.
  const childScript = path.join(root, 'claim-child.mts');
  await writeFile(
    childScript,
    `import { acquireWriterLock } from ${JSON.stringify(path.join(moduleDir, 'guest-cart-writer-lock.ts'))};
try {
  acquireWriterLock(process.argv[2]);
  console.log('owner:' + process.pid);
  await new Promise((resolve) => setTimeout(resolve, 3000));
} catch {
  console.log('refused');
}`
  );
  const run = () =>
    new Promise<string>((resolve, reject) => {
      const child = spawn(tsxExecutable, [childScript, root], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout?.on('data', (chunk) => {
        output += chunk.toString();
      });
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('lock race child timed out'));
      }, 15000);
      timer.unref();
      child.on('error', reject);
      child.on('close', () => {
        clearTimeout(timer);
        resolve(output);
      });
    });
  const [first, second] = await Promise.all([run(), run()]);
  const owners = (first + second).match(/owner:\d+/g) ?? [];
  expect(owners).toHaveLength(1);
  expect(first + second).toContain('refused');
  await expect(readFile(lock, 'utf8')).resolves.toContain(
    `"pid":${owners[0].split(':')[1]}`
  );
});

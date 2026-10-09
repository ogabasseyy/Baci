import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import {
  SHUTDOWN_DRAIN_TIMEOUT_MS,
  createGracefulShutdown,
} from './server-shutdown';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('exits only after the server finishes draining', () => {
  const order: string[] = [];
  let done: (() => void) | undefined;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const shutdown = createGracefulShutdown({
    closeServer: (finished) => {
      order.push('close');
      done = finished;
    },
    exit: (code) => {
      order.push(`exit:${code}`);
    },
  });
  shutdown();
  expect(order).toEqual(['close']);
  done?.();
  expect(order).toEqual(['close', 'exit:0']);
});

it('forces the exit when the drain never finishes', () => {
  vi.useFakeTimers();
  const order: string[] = [];
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const shutdown = createGracefulShutdown({
    closeServer: () => {
      order.push('close');
    },
    exit: (code) => {
      order.push(`exit:${code}`);
    },
  });
  shutdown();
  expect(order).toEqual(['close']);
  vi.advanceTimersByTime(SHUTDOWN_DRAIN_TIMEOUT_MS);
  expect(order).toEqual(['close', 'exit:0']);
  expect(error).toHaveBeenCalledWith(
    expect.stringContaining('shutdown-timeout')
  );
});

it('fails closed before listening when startup validation exits early', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'guest-startup-exit-'));
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.dirname(path.dirname(path.dirname(moduleDir)));
  const tsxExecutable = path.join(
    repoRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx'
  );
  // Missing Supabase env must fail the process before it serves traffic.
  const childScript = path.join(root, 'startup-child.mts');
  await writeFile(
    childScript,
    `await import(${JSON.stringify(path.join(moduleDir, 'server.ts'))});\n`
  );
  try {
    const env = { ...process.env };
    delete env.NEXT_PUBLIC_SUPABASE_URL;
    delete env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const outcome = await new Promise<{ code: number; stderr: string }>(
      (resolve, reject) => {
        const child = spawn(tsxExecutable, [childScript], {
          // tsx resolves tsconfig paths from the cwd: pin it to the app
          // so the child reaches startup validation no matter where
          // vitest was invoked from.
          cwd: path.dirname(moduleDir),
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stderr = '';
        child.stderr?.on('data', (chunk) => {
          stderr += chunk.toString();
        });
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error('startup child timed out'));
        }, 60000);
        timer.unref();
        child.on('error', reject);
        child.on('close', (exitCode) => {
          clearTimeout(timer);
          resolve({ code: exitCode ?? -1, stderr });
        });
      }
    );
    expect(outcome.code).toBe(1);
    // Fail closed: only a child that reached the env validation proves
    // anything (an import-time crash would also exit 1).
    expect(outcome.stderr).toContain('FATAL: Missing required environment');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 90000);

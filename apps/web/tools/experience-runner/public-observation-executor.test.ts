import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { expect, it, vi } from 'vitest';
import {
  PUBLIC_ROUTE_TIMEOUT_MS,
  publicObservationTimeoutMs,
} from './public-observation-deadline';
import {
  createPublicObservationExecutor,
  runPublicObservationJob,
} from './public-observation-executor';
import { MAX_PUBLIC_OBSERVATION_START_BYTES } from './public-observation-resource-limit';

it('gives the subprocess and cart channel the same budget for the full route matrix', async () => {
  const timer = vi.spyOn(globalThis, 'setTimeout');
  const routeCount = 128;
  const start = () =>
    spawn(
      process.execPath,
      [
        '-e',
        `process.stdin.once('data', () => { process.stdout.end(JSON.stringify({type:'done', observation:{status:'synthetic'}})+'\\n'); process.stdin.destroy(); });`,
      ],
      { stdio: 'pipe' }
    );
  try {
    await runPublicObservationJob(
      {
        payload: {},
        routeCount,
        session: async () => ({ status: 200, body: '{}' }),
      },
      { command: async () => '', start }
    );
    const budget = publicObservationTimeoutMs(routeCount);
    expect(budget - publicObservationTimeoutMs(1)).toBe(
      (routeCount - 1) * PUBLIC_ROUTE_TIMEOUT_MS
    );
    expect(timer.mock.calls.filter(([, ms]) => ms === budget)).toHaveLength(2);
  } finally {
    timer.mockRestore();
  }
});

it('uses one fixed helper job and accepts output only after successful process exit and cleanup', async () => {
  const command = vi.fn(async (_program: string, _args: string[]) => '');
  const start = vi.fn(() =>
    spawn(
      process.execPath,
      [
        '-e',
        `process.stdin.once('data', () => { process.stdout.end(JSON.stringify({type:'done', observation:{status:'synthetic'}})+'\\n'); process.stdin.destroy(); });`,
      ],
      { stdio: 'pipe' }
    )
  );
  const result = await runPublicObservationJob(
    {
      payload: { synthetic: true },
      session: async () => ({ status: 200, body: '{}' }),
    },
    { command, start }
  );
  expect(result.output).toEqual({ status: 'synthetic' });
  expect(command.mock.calls.map((args) => args[1].slice(0, 3))).toEqual([
    ['-n', '/usr/local/libexec/baci-experience-helper', 'prepare'],
    ['-n', '/usr/local/libexec/baci-experience-helper', 'delete'],
  ]);
  expect(command.mock.calls[0][1][3]).toBe('public-observe');
  expect(command.mock.calls[0][1][4]).toBe(result.jobId);
  expect(command.mock.calls[1][1][3]).toBe(result.jobId);
});

it('rejects a worker that reports success but exits nonzero and still cleans up', async () => {
  const command = vi.fn(async () => '');
  const start = vi.fn(() =>
    spawn(
      process.execPath,
      [
        '-e',
        `process.stdin.once('data', () => { process.stdout.end(JSON.stringify({type:'done', observation:{status:'synthetic'}})+'\\n', () => process.exit(7)); });`,
      ],
      { stdio: 'pipe' }
    )
  );
  await expect(
    runPublicObservationJob(
      { payload: {}, session: async () => ({ status: 200, body: '{}' }) },
      { command, start }
    )
  ).rejects.toThrow('PUBLIC_OBSERVATION_FAILED');
  expect(command).toHaveBeenCalledTimes(2);
});

it('never reports success if helper cleanup fails', async () => {
  const command = vi.fn(async (_program: string, args: string[]) => {
    if (args[2] === 'delete') throw Error('cleanup failed');
    return '';
  });
  const start = () =>
    spawn(
      process.execPath,
      [
        '-e',
        `process.stdin.once('data', () => { process.stdout.end(JSON.stringify({type:'done', observation:{status:'synthetic'}})+'\\n'); process.stdin.destroy(); });`,
      ],
      { stdio: 'pipe' }
    );
  const run = createPublicObservationExecutor({ command, start });
  const input = {
    payload: {},
    session: async () => ({ status: 200, body: '{}' }),
  };
  await expect(run(input)).rejects.toThrow('PUBLIC_OBSERVATION_CLEANUP_FAILED');
  await expect(run(input)).rejects.toThrow(
    'PUBLIC_OBSERVATION_RECONCILIATION_REQUIRED'
  );
  expect(command).toHaveBeenCalledTimes(2);
});

it('does not start an oversized job or run a job after preparation failure', async () => {
  const command = vi.fn(async () => {
    throw Error('prepare failed');
  });
  const start = vi.fn();
  await expect(
    runPublicObservationJob(
      {
        payload: 'x'.repeat(MAX_PUBLIC_OBSERVATION_START_BYTES + 1),
        session: async () => ({ status: 200, body: '{}' }),
      },
      { command, start }
    )
  ).rejects.toThrow();
  expect(command).not.toHaveBeenCalled();
  await expect(
    runPublicObservationJob(
      { payload: {}, session: async () => ({ status: 200, body: '{}' }) },
      { command, start }
    )
  ).rejects.toThrow('PUBLIC_OBSERVATION_PREPARE_UNCERTAIN');
  expect(start).not.toHaveBeenCalled();
});

it('reconciles the exact prepared observer job when its receipt is lost', async () => {
  let prepared: string | undefined;
  const command = vi.fn(async (_program: string, argv: string[]) => {
    if (argv[2] === 'prepare') {
      prepared = argv[4];
      throw Error('lost preparation receipt');
    }
    expect(argv.slice(2)).toEqual(['delete', prepared]);
    prepared = undefined;
    return '';
  });
  const start = vi.fn();
  await expect(
    runPublicObservationJob(
      { payload: {}, session: async () => ({ status: 200, body: '{}' }) },
      { command, start }
    )
  ).rejects.toThrow('PUBLIC_OBSERVATION_FAILED');
  expect(command).toHaveBeenCalledTimes(2);
  expect(prepared).toBeUndefined();
  expect(start).not.toHaveBeenCalled();
});

it('rejects the next job after prepare and cleanup leave observer state uncertain', async () => {
  const command = vi.fn(async () => {
    throw Error('synthetic helper timeout');
  });
  const start = vi.fn();
  const run = createPublicObservationExecutor({ command, start });
  const input = {
    payload: {},
    session: async () => ({ status: 200, body: '{}' }),
  };
  await expect(run(input)).rejects.toThrow(
    'PUBLIC_OBSERVATION_PREPARE_UNCERTAIN'
  );
  await expect(run(input)).rejects.toThrow(
    'PUBLIC_OBSERVATION_RECONCILIATION_REQUIRED'
  );
  expect(command).toHaveBeenCalledTimes(2);
  expect(start).not.toHaveBeenCalled();
});

it('exchanges a start frame above 8 MiB and real duplex requests with a separate worker process', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'baci-observation-fixture-'));
  try {
    const file = join(dir, 'worker.mjs');
    await build({
      entryPoints: [
        'tools/experience-runner/public-observation-subprocess.fixture.ts',
      ],
      outfile: file,
      bundle: true,
      platform: 'node',
      format: 'esm',
      logLevel: 'silent',
    });
    const command = vi.fn(async () => '');
    const start = () => spawn(process.execPath, [file], { stdio: 'pipe' });
    const session = vi.fn(async () => ({ status: 200, body: '{"items":1}' }));
    const result = await runPublicObservationJob(
      {
        payload: { synthetic: true, data: 'a'.repeat(11 * 1024 ** 2) },
        session,
      },
      { command, start }
    );
    expect(result.output).toEqual({ status: 'synthetic', cart: { items: 1 } });
    expect(session).toHaveBeenCalledOnce();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('cancels a running observer and holds completion until owned cleanup settles', async () => {
  const controller = new AbortController();
  const started = Promise.withResolvers<void>();
  const cleaning = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const command = vi.fn(async (_program: string, args: string[]) => {
    if (args[2] === 'delete') {
      cleaning.resolve();
      await release.promise;
    }
    return '';
  });
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'pipe',
  });
  const start = () => {
    started.resolve();
    return child;
  };
  let settled = false;
  const result = runPublicObservationJob(
    {
      payload: {},
      signal: controller.signal,
      session: async () => ({ status: 200, body: '{}' }),
    },
    { command, start }
  ).finally(() => {
    settled = true;
  });
  const rejected = expect(result).rejects.toThrow('PUBLIC_OBSERVATION_FAILED');
  try {
    await started.promise;
    controller.abort();
    await cleaning.promise;
    expect(child.signalCode).toBe('SIGKILL');
    expect(settled).toBe(false);
  } finally {
    release.resolve();
    child.kill('SIGKILL');
  }
  await rejected;
}, 3000);

it('cleans an owned preparation interrupted by abort without starting the worker', async () => {
  const controller = new AbortController();
  const preparing = Promise.withResolvers<void>();
  const prepared = Promise.withResolvers<void>();
  const command = vi.fn(async (_program: string, args: string[]) => {
    if (args[2] === 'prepare') {
      preparing.resolve();
      await prepared.promise;
    }
    return '';
  });
  const start = vi.fn();
  const result = runPublicObservationJob(
    {
      payload: {},
      signal: controller.signal,
      session: async () => ({ status: 200, body: '{}' }),
    },
    { command, start }
  );
  const rejected = expect(result).rejects.toThrow('PUBLIC_OBSERVATION_FAILED');
  await preparing.promise;
  controller.abort();
  expect(command).toHaveBeenCalledTimes(1);
  prepared.resolve();
  await rejected;
  expect(start).not.toHaveBeenCalled();
  expect(command.mock.calls.map(([, args]) => args[2])).toEqual([
    'prepare',
    'delete',
  ]);
});

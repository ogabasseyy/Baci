import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { expect, it, vi } from 'vitest';
import { runPublicObservationJob } from './public-observation-executor';

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
  await expect(
    runPublicObservationJob(
      { payload: {}, session: async () => ({ status: 200, body: '{}' }) },
      { command, start }
    )
  ).rejects.toThrow('PUBLIC_OBSERVATION_CLEANUP_FAILED');
});

it('does not start an oversized job or run a job after preparation failure', async () => {
  const command = vi.fn(async () => {
    throw Error('prepare failed');
  });
  const start = vi.fn();
  await expect(
    runPublicObservationJob(
      {
        payload: 'x'.repeat(8388609),
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

it('exchanges a start frame and real duplex requests with a separate worker process', async () => {
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
      { payload: { synthetic: true }, session },
      { command, start }
    );
    expect(result.output).toEqual({ status: 'synthetic', cart: { items: 1 } });
    expect(session).toHaveBeenCalledOnce();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

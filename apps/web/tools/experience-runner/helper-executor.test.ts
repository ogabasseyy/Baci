import { expect, it, vi } from 'vitest';
import {
  createHelperQualificationExecutor,
  runHelperQualification,
} from './helper-executor';

it('uses only the fixed privileged helper and cleans up the matching job', async () => {
  const calls: Array<{ program: string; args: string[]; input?: string }> = [];
  const command = vi.fn(
    async (program: string, args: string[], input?: string) => {
      calls.push({ program, args, input });
      return args[2] === 'run' ? '{"status":"synthetic"}' : '';
    }
  );
  const result = await runHelperQualification(
    'compile',
    { source: 'synthetic' },
    command
  );
  expect(result.output).toEqual({ status: 'synthetic' });
  expect(calls.map((call) => call.program)).toEqual([
    '/usr/bin/sudo',
    '/usr/bin/sudo',
    '/usr/bin/sudo',
  ]);
  expect(calls.map((call) => call.args.slice(0, 3))).toEqual([
    ['-n', '/usr/local/libexec/baci-experience-helper', 'prepare'],
    ['-n', '/usr/local/libexec/baci-experience-helper', 'run'],
    ['-n', '/usr/local/libexec/baci-experience-helper', 'delete'],
  ]);
  expect(calls[0].args[3]).toBe('compile');
  expect(calls[0].args[4]).toBe(result.jobId);
  expect(calls[1].args[3]).toBe(result.jobId);
  expect(calls[2].args[3]).toBe(result.jobId);
  expect(calls[0].input).toBeUndefined();
  expect(calls[1].input).toBe(JSON.stringify({ source: 'synthetic' }));
});

it('refuses unknown jobs and preserves a run failure if cleanup fails', async () => {
  const command = vi.fn(async (_program: string, args: string[]) => {
    if (args[2] === 'run') throw Error('RUN_FAILED');
    if (args[2] === 'delete') throw Error('DELETE_FAILED');
    return '';
  });
  await expect(
    runHelperQualification('unknown' as never, {}, command)
  ).rejects.toThrow('INVALID_RUNNER_KIND');
  expect(command).not.toHaveBeenCalled();
  await expect(runHelperQualification('compile', {}, command)).rejects.toThrow(
    'RUN_FAILED'
  );
  expect(command).toHaveBeenCalledTimes(3);
});

it('reconciles the same job if preparation loses its response', async () => {
  let bundle: string | undefined;
  const command = vi.fn(async (_program: string, args: string[]) => {
    if (args[2] === 'prepare') {
      bundle = args[4];
      throw Error('PREPARE_FAILED');
    }
    expect(args[2]).toBe('delete');
    expect(args[3]).toBe(bundle);
    bundle = undefined;
    return '';
  });
  await expect(runHelperQualification('compile', {}, command)).rejects.toThrow(
    'PREPARE_FAILED'
  );
  expect(command).toHaveBeenCalledTimes(2);
  expect(bundle).toBeUndefined();
});

it('stops admission after uncertain prepare and failed cleanup', async () => {
  const command = vi.fn(async (_program: string, args: string[]) => {
    if (args[2] === 'prepare') throw Error('PREPARE_FAILED');
    expect(args[2]).toBe('delete');
    throw Error('DELETE_FAILED');
  });
  const execute = createHelperQualificationExecutor(command);
  await expect(execute('compile', {})).rejects.toThrow('PREPARE_FAILED');
  await expect(execute('capture', {})).rejects.toThrow(
    'RUNNER_JOB_RECONCILIATION_REQUIRED'
  );
  expect(command).toHaveBeenCalledTimes(2);
});

it('cleans up the exact prepared bundle when the run is aborted', async () => {
  const controller = new AbortController();
  const command = vi.fn(
    async (
      _program: string,
      args: string[],
      _input: string | undefined,
      _timeout: number,
      signal?: AbortSignal
    ) => {
      if (args[2] === 'run') {
        expect(signal).toBe(controller.signal);
        controller.abort();
        signal?.throwIfAborted();
      }
      expect(signal).toBeUndefined();
      return '';
    }
  );
  await expect(
    createHelperQualificationExecutor(command)('compile', {}, controller.signal)
  ).rejects.toThrow();
  const [prepare, run, cleanup] = command.mock.calls;
  expect(run[1][3]).toBe(prepare[1][4]);
  expect(cleanup[1].slice(2)).toEqual(['delete', run[1][3]]);
});

it('reports cleanup failures following a successful run', async () => {
  const cleanupFails = vi.fn(async (_program: string, args: string[]) => {
    if (args[2] === 'delete') throw Error('DELETE_FAILED');
    return args[2] === 'run' ? '{}' : '';
  });
  await expect(
    runHelperQualification('compile', {}, cleanupFails)
  ).rejects.toThrow('DELETE_FAILED');
});

it.each([
  'prerender-checks',
  'prerender-private-checks',
  'durable-public-checks',
] as const)('rejects uninstalled fixture-only browser job %s before invoking the helper', async (kind) => {
  const command = vi.fn(async () => '{}');
  await expect(runHelperQualification(kind, {}, command)).rejects.toThrow(
    'INVALID_RUNNER_KIND'
  );
  expect(command).not.toHaveBeenCalled();
});

import { expect, it, vi } from 'vitest';
import { runHelperQualification } from './helper-executor';

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

it('does not run a job if preparation fails and reports cleanup failures', async () => {
  const prepareFails = vi.fn(async () => {
    throw Error('PREPARE_FAILED');
  });
  await expect(
    runHelperQualification('compile', {}, prepareFails)
  ).rejects.toThrow('PREPARE_FAILED');
  expect(prepareFails).toHaveBeenCalledTimes(1);
  const cleanupFails = vi.fn(async (_program: string, args: string[]) => {
    if (args[2] === 'delete') throw Error('DELETE_FAILED');
    return args[2] === 'run' ? '{}' : '';
  });
  await expect(
    runHelperQualification('compile', {}, cleanupFails)
  ).rejects.toThrow('DELETE_FAILED');
});

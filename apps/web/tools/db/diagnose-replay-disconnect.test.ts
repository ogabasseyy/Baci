import { expect, it, vi } from 'vitest';
import { diagnoseReplayDisconnect } from './diagnose-replay-disconnect';

const project = `baci_replay_${'a'.repeat(24)}`;
const name = `supabase_db_${project}`;
const expected = { containers: [{ name }], networks: [], volumes: [] };
const inspect = async () => ({
  containers: [{ name, labels: { 'com.supabase.cli.project': project } }],
  networks: [],
  volumes: [],
});
const failure = new Error(
  'Replay SQL check failed at ordinal 189: non-zero-exit (line=89,shape=0000,exit=2)'
);

it('emits only allowlisted flags from the owned container', async () => {
  const run = vi
    .fn()
    .mockResolvedValueOnce({ stdout: 'true|137|1|exited', stderr: 'private' })
    .mockResolvedValueOnce({
      stdout: 'server process terminated by signal 9\nsecret identity',
      stderr: 'PANIC private credential',
    });
  const result = await diagnoseReplayDisconnect(
    failure,
    project,
    expected,
    inspect,
    run
  );
  expect(result).toBeInstanceOf(Error);
  expect((result as Error).message).toBe(
    `${failure.message} (dbflags=111111001)`
  );
  expect(run).toHaveBeenCalledTimes(2);
});

it('does not inspect other projects, ordinary failures, or unowned containers', async () => {
  const run = vi.fn();
  const wrongOwner = async () => ({
    containers: [{ name, labels: {} }],
    networks: [],
    volumes: [],
  });
  expect(
    await diagnoseReplayDisconnect(failure, project, expected, wrongOwner, run)
  ).toBe(failure);
  expect(
    await diagnoseReplayDisconnect(
      new Error('unrelated'),
      project,
      expected,
      inspect,
      run
    )
  ).toEqual(new Error('unrelated'));
  expect(
    await diagnoseReplayDisconnect(failure, 'other', expected, inspect, run)
  ).toBe(failure);
  expect(run).not.toHaveBeenCalled();
});

it('retains the original failure if state inspection fails and distinguishes unavailable logs', async () => {
  const broken = vi.fn().mockRejectedValue(new Error('secret'));
  expect(
    await diagnoseReplayDisconnect(failure, project, expected, inspect, broken)
  ).toBe(failure);
  const run = vi
    .fn()
    .mockResolvedValueOnce({ stdout: 'false|0|0|running', stderr: '' })
    .mockRejectedValueOnce(new Error('secret'));
  const result = await diagnoseReplayDisconnect(
    failure,
    project,
    expected,
    inspect,
    run
  );
  expect((result as Error).message).toBe(
    `${failure.message} (dbflags=000000000)`
  );
});

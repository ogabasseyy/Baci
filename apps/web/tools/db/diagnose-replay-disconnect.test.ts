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
    `${failure.message} (dbflags=111111001,dbsignal=kill,dbprobe=0,dbphases=000)`
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
    `${failure.message} (dbflags=000000000,dbsignal=none,dbprobe=0,dbphases=000)`
  );
});

it('reports only emitted warning phases, not matching SQL source in crash details', async () => {
  const run = vi
    .fn()
    .mockResolvedValueOnce({ stdout: 'false|0|0|running', stderr: '' })
    .mockResolvedValueOnce({
      stdout:
        "WARNING: OXYGEN_CI_ANON_BEFORE_CALL\nDETAIL: Failed process was running: RAISE WARNING 'OXYGEN_CI_ANON_DENIED'; private-value",
      stderr: '',
    });
  const result = await diagnoseReplayDisconnect(
    failure,
    project,
    expected,
    inspect,
    run
  );
  expect((result as Error).message).toContain('dbphases=100');
  expect((result as Error).message).not.toContain('private-value');
});

it('correlates the fixed SQL probe only with a backend signal detail', async () => {
  const run = vi
    .fn()
    .mockResolvedValueOnce({ stdout: 'false|0|0|running', stderr: '' })
    .mockResolvedValueOnce({
      stdout:
        'server process (PID 42) was terminated by signal 11\nDETAIL: Failed process was running: DO $$ BEGIN\n /* OXYGEN_CI_ANON_DRAFT_PROBE */ private-content\nEND $$;',
      stderr: '',
    });
  const result = await diagnoseReplayDisconnect(
    failure,
    project,
    expected,
    inspect,
    run
  );
  expect((result as Error).message).toContain('dbsignal=segv,dbprobe=1');
  expect((result as Error).message).not.toContain('private-content');
});

it.each([
  [
    'server process (PID 42) was terminated by signal 11: Segmentation fault',
    'segv',
  ],
  ['server process (PID 42) was terminated by signal 6: Aborted', 'abort'],
  ['server process terminated by signal 15', 'other'],
  ['private secret signal 11', 'none'],
])('classifies only fixed server process signal shapes', async (log, expectedSignal) => {
  const run = vi
    .fn()
    .mockResolvedValueOnce({ stdout: 'false|0|0|running', stderr: '' })
    .mockResolvedValueOnce({ stdout: log, stderr: '' });
  const result = await diagnoseReplayDisconnect(
    failure,
    project,
    expected,
    inspect,
    run
  );
  expect((result as Error).message).toContain(`dbsignal=${expectedSignal}`);
  expect((result as Error).message).not.toContain(log);
});

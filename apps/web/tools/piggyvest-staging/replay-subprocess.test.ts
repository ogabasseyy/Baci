import { expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => {
  const execFile = vi.fn();
  return { execFile, default: { execFile } };
});

import { execFile } from 'node:child_process';
import { runReplaySubprocess } from './replay-subprocess';

it('kills a stuck pass and never surfaces child output or secret errors', async () => {
  vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
    const callback = args.at(-1) as (error: Error | null) => void;
    callback(new Error('secret provider response'));
    return {} as ReturnType<typeof execFile>;
  });
  const signal = new AbortController().signal;
  await expect(runReplaySubprocess('/app/replay.mjs', signal)).rejects.toThrow(
    'Staging replay subprocess failed'
  );
  expect(execFile).toHaveBeenCalledWith(
    process.execPath,
    ['/app/replay.mjs', '--pass'],
    expect.objectContaining({ timeout: 90_000, killSignal: 'SIGKILL', signal }),
    expect.any(Function)
  );
});

it('resolves only once the child process finishes', async () => {
  vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
    const callback = args.at(-1) as (
      error: Error | null,
      stdout: string
    ) => void;
    callback(
      null,
      JSON.stringify({
        replay: 'staging-pass-complete',
        claimed: 2,
        processed: 0,
        quarantined: 2,
        retryable: 0,
        resolutionFailures: 0,
      })
    );
    return {} as ReturnType<typeof execFile>;
  });
  const report = vi.fn();
  await expect(
    runReplaySubprocess('/app/replay.mjs', new AbortController().signal, report)
  ).resolves.toBeUndefined();
  expect(report).toHaveBeenCalledWith(
    expect.objectContaining({ claimed: 2, quarantined: 2, processed: 0 })
  );
});

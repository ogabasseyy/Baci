import { expect, it, vi } from 'vitest';
import { runReplayDaemonCommand } from './replay-daemon-command';

function fixture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const check = vi.fn(async (): Promise<unknown> => ({ ready: true }));
  const pass = vi.fn(async () => undefined);
  const daemon = vi.fn(async () => undefined);
  return {
    stdout,
    stderr,
    check,
    pass,
    daemon,
    handlers: {
      check,
      pass,
      daemon,
      stdout: (line: string) => stdout.push(line),
      stderr: (line: string) => stderr.push(line),
    },
  };
}

it('--check writes the exact successful report without passing or starting the daemon', async () => {
  const sample = fixture();
  await expect(
    runReplayDaemonCommand(['--check'], sample.handlers)
  ).resolves.toBe(0);
  expect(sample.stdout).toEqual([
    '{"status":"replay-runtime-ready","readOnly":true}\n',
  ]);
  expect(sample.stderr).toEqual([]);
  expect(sample.check).toHaveBeenCalledOnce();
  expect(sample.pass).not.toHaveBeenCalled();
  expect(sample.daemon).not.toHaveBeenCalled();
});

it.each([
  'configuration',
  'financial-database',
  'interest-authority',
  'prefunded-runtime',
  'receipt-database',
  'app-database',
])('--check reports the fixed %s refusal shape', async (stage) => {
  const sample = fixture();
  sample.check.mockResolvedValue({ ready: false, stage });
  await expect(
    runReplayDaemonCommand(['--check'], sample.handlers)
  ).resolves.toBe(1);
  expect(sample.stdout).toEqual([]);
  expect(sample.stderr).toEqual([
    `${JSON.stringify({ status: 'replay-runtime-not-ready', readOnly: true, stage })}\n`,
  ]);
});

it('uses a fixed readiness stage for unexpected secret-bearing check rejection', async () => {
  const sample = fixture();
  sample.check.mockRejectedValue(new Error('token=super-secret'));
  await expect(
    runReplayDaemonCommand(['--check'], sample.handlers)
  ).resolves.toBe(1);
  expect(sample.stderr).toEqual([
    '{"status":"replay-runtime-not-ready","readOnly":true,"stage":"readiness"}\n',
  ]);
  expect(sample.stderr.join('')).not.toContain('super-secret');
});

it('does not allow result fields to smuggle an unrecognized stage', async () => {
  const sample = fixture();
  sample.check.mockResolvedValue({
    ready: false,
    stage: 'token=super-secret',
    detail: 'private response',
  });
  await expect(
    runReplayDaemonCommand(['--check'], sample.handlers)
  ).resolves.toBe(1);
  expect(sample.stderr).toEqual([
    '{"status":"replay-runtime-not-ready","readOnly":true,"stage":"readiness"}\n',
  ]);
});

it('rejects invalid arguments without checking, passing, or starting daemon mode', async () => {
  const sample = fixture();
  await expect(
    runReplayDaemonCommand(['--check', 'extra'], sample.handlers)
  ).resolves.toBe(1);
  expect(sample.stdout).toEqual([]);
  expect(sample.stderr).toEqual([
    '{"status":"replay-runtime-invalid-command","readOnly":true}\n',
  ]);
  expect(sample.check).not.toHaveBeenCalled();
  expect(sample.pass).not.toHaveBeenCalled();
  expect(sample.daemon).not.toHaveBeenCalled();
});

it('preserves no-argument daemon mode and --pass behavior', async () => {
  const daemonSample = fixture();
  await expect(runReplayDaemonCommand([], daemonSample.handlers)).resolves.toBe(
    0
  );
  expect(daemonSample.daemon).toHaveBeenCalledOnce();
  expect(daemonSample.check).not.toHaveBeenCalled();
  expect(daemonSample.pass).not.toHaveBeenCalled();

  const passSample = fixture();
  await expect(
    runReplayDaemonCommand(['--pass'], passSample.handlers)
  ).resolves.toBe(0);
  expect(passSample.pass).toHaveBeenCalledOnce();
  expect(passSample.check).not.toHaveBeenCalled();
  expect(passSample.daemon).not.toHaveBeenCalled();
});

it('keeps daemon failures nonzero with the legacy failure report and no read-only claim', async () => {
  const sample = fixture();
  sample.daemon.mockRejectedValue(new Error('daemon failed'));
  await expect(runReplayDaemonCommand([], sample.handlers)).resolves.toBe(1);
  expect(sample.stderr).toEqual(['{"replay":"daemon-failed"}\n']);
  expect(sample.stderr.join('')).not.toContain('readOnly');
});

it('keeps pass failures nonzero without reporting a read-only result', async () => {
  const sample = fixture();
  sample.pass.mockRejectedValue(new Error('pass failed'));
  await expect(
    runReplayDaemonCommand(['--pass'], sample.handlers)
  ).resolves.toBe(1);
  expect(sample.stderr).toEqual([]);
});

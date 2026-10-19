import { describe, expect, it, vi } from 'vitest';
import { runSavingsNotificationsCli } from './run';

const successfulResult = {
  enabled: true,
  enqueued: 3,
  claimed: 2,
  accepted: 1,
  rejected: 0,
  unknown: 1,
  finishFailed: 0,
  receiptChecked: 1,
  receiptProviderConfirmed: 1,
  receiptFailed: 0,
  receiptPending: 0,
  receiptRecordFailed: 0,
};

describe('runSavingsNotificationsCli', () => {
  it('passes check-only mode to the worker without treating it as a dispatch run', async () => {
    const writeOutput = vi.fn();
    const runWorker = vi.fn().mockResolvedValue({
      ...successfulResult,
      enqueued: 0,
      claimed: 0,
      accepted: 0,
      rejected: 0,
      unknown: 0,
      receiptChecked: 0,
      receiptProviderConfirmed: 0,
      receiptFailed: 0,
      receiptPending: 0,
    });

    const exitCode = await runSavingsNotificationsCli({
      args: ['--check'],
      runWorker,
      writeOutput,
    });

    expect(exitCode).toBe(0);
    expect(runWorker).toHaveBeenCalledWith({ checkOnly: true });
    expect(JSON.parse(writeOutput.mock.calls[0][0])).toMatchObject({
      enabled: true,
      enqueued: 0,
      claimed: 0,
      accepted: 0,
      receiptChecked: 0,
    });
  });

  it.each([
    ['--check', '--unexpected'],
    ['--unexpected'],
  ])('rejects invalid CLI arguments %j before invoking the worker', async (...args) => {
    const runWorker = vi.fn();
    const writeError = vi.fn();

    const exitCode = await runSavingsNotificationsCli({
      args,
      runWorker,
      writeError,
    });

    expect(exitCode).toBe(64);
    expect(runWorker).not.toHaveBeenCalled();
    expect(writeError).toHaveBeenCalledWith(
      'Invalid savings notification worker arguments.'
    );
  });

  it('prints only safe aggregate counts and returns success for an enabled worker', async () => {
    const writeOutput = vi.fn();
    const writeError = vi.fn();

    const exitCode = await runSavingsNotificationsCli({
      runWorker: vi.fn().mockResolvedValue(successfulResult),
      writeOutput,
      writeError,
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(writeOutput.mock.calls[0][0])).toEqual(successfulResult);
    expect(writeError).not.toHaveBeenCalled();
  });

  it('returns a nonzero status when the runtime reports the feature is disabled', async () => {
    const writeError = vi.fn();

    const exitCode = await runSavingsNotificationsCli({
      runWorker: vi.fn().mockResolvedValue({
        ...successfulResult,
        enabled: false,
      }),
      writeError,
    });

    expect(exitCode).toBe(2);
    expect(writeError).toHaveBeenCalledWith(
      'Savings notification worker is disabled.'
    );
  });

  it.each([
    ['push finish', { finishFailed: 1, receiptRecordFailed: 0 }],
    ['receipt record', { finishFailed: 0, receiptRecordFailed: 1 }],
  ])('returns a persistence failure status after a %s failure', async (_, failures) => {
    const writeOutput = vi.fn();
    const writeError = vi.fn();

    const exitCode = await runSavingsNotificationsCli({
      runWorker: vi
        .fn()
        .mockResolvedValue({ ...successfulResult, ...failures }),
      writeOutput,
      writeError,
    });

    expect(exitCode).toBe(3);
    expect(JSON.parse(writeOutput.mock.calls[0][0])).toMatchObject(failures);
    expect(writeError).toHaveBeenCalledWith(
      'Savings notification worker persistence failures detected.'
    );
  });

  it('does not expose runtime exceptions in output or exit detail', async () => {
    const writeOutput = vi.fn();
    const writeError = vi.fn();

    const exitCode = await runSavingsNotificationsCli({
      runWorker: vi
        .fn()
        .mockRejectedValue(
          new Error('postgres://worker:private-password@host/database')
        ),
      writeOutput,
      writeError,
    });

    expect(exitCode).toBe(1);
    expect(writeOutput).not.toHaveBeenCalled();
    expect(writeError).toHaveBeenCalledWith(
      'Savings notification worker failed; details withheld.'
    );
    expect(JSON.stringify(writeError.mock.calls)).not.toContain(
      'private-password'
    );
  });
});

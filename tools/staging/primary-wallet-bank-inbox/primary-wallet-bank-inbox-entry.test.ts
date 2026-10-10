import { beforeEach, expect, it, vi } from 'vitest';

const launch = vi.hoisted(() => vi.fn());
vi.mock('./primary-wallet-bank-inbox-cli', () => ({
  primaryWalletBankInboxCli: launch,
}));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});
it('emits the successful worker result as one JSON line without changing exit status', async () => {
  const result = { claimed: 1, processed: 0, deferred: 1, blocked: 0 };
  launch.mockResolvedValueOnce(result);
  const stdout = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  const stderr = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(() => true);
  const previous = process.exitCode;
  try {
    await import('./primary-wallet-bank-inbox-entry');
    await Promise.resolve();
    expect(stdout).toHaveBeenCalledExactlyOnceWith(
      `${JSON.stringify(result)}\n`
    );
    expect(stderr).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(previous);
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
});
it('emits only redacted operational failure and nonzero exit status', async () => {
  launch.mockRejectedValueOnce(
    new Error('private database/password/raw payload')
  );
  const write = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(() => true);
  const previous = process.exitCode;
  try {
    await import('./primary-wallet-bank-inbox-entry');
    await Promise.resolve();
    expect(write).toHaveBeenCalledWith(
      'Primary bank receipt worker unavailable\n'
    );
    expect(process.exitCode).toBe(1);
  } finally {
    process.exitCode = previous;
    write.mockRestore();
  }
});

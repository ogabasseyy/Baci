import { afterEach, expect, it, vi } from 'vitest';
import { runPrimaryCardTransferOutbox } from '../../../apps/web/src/lib/piggyvest/primary-wallet-card-transfer-outbox';
import { primaryCardTransferCli } from './primary-wallet-card-transfer-cli';

vi.mock(
  '../../../apps/web/src/lib/piggyvest/primary-wallet-card-transfer-outbox',
  () => ({ runPrimaryCardTransferOutbox: vi.fn() })
);
afterEach(() => vi.clearAllMocks());
it('launches a bounded worker with the exact runtime environment and removes signal handlers', async () => {
  const environment = { SYNTHETIC: 'test' };
  const before = process.listenerCount('SIGTERM');
  await primaryCardTransferCli(['--once'], environment);
  expect(runPrimaryCardTransferOutbox).toHaveBeenCalledWith({
    mode: 'once',
    environment,
    signal: expect.any(AbortSignal),
  });
  expect(process.listenerCount('SIGTERM')).toBe(before);
});
it('supports nonfinancial readiness and propagates worker/storage failure', async () => {
  await primaryCardTransferCli(['--readiness'], {});
  expect(runPrimaryCardTransferOutbox).toHaveBeenCalledWith(
    expect.objectContaining({ mode: 'readiness' })
  );
  vi.mocked(runPrimaryCardTransferOutbox).mockRejectedValueOnce(
    new Error('failure')
  );
  await expect(primaryCardTransferCli(['--once'], {})).rejects.toThrow(
    'failure'
  );
});
it('rejects extra or unbounded arguments before entering the worker', async () => {
  for (const args of [[], ['--loop'], ['--once', '2']])
    await expect(primaryCardTransferCli(args, {})).rejects.toThrow('Usage');
  expect(runPrimaryCardTransferOutbox).not.toHaveBeenCalled();
});

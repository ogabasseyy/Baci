import { beforeEach, expect, it, vi } from 'vitest';
import { primaryBankInboxFixture as fixture } from '../../../apps/web/src/lib/piggyvest/primary-wallet-bank-inbox.test-fixture';
import { primaryWalletBankInboxCli } from './primary-wallet-bank-inbox-cli';

const mocks = vi.hoisted(() => ({ readiness: vi.fn(), drain: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock(
  '../../../apps/web/src/lib/piggyvest/primary-wallet-bank-inbox-store',
  () => ({
    createPrimaryWalletBankInboxStore: () => ({ readiness: mocks.readiness }),
  })
);
vi.mock(
  '../../../apps/web/src/lib/piggyvest/primary-wallet-bank-inbox-worker',
  () => ({ drainPrimaryWalletBankInbox: mocks.drain })
);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.readiness.mockResolvedValue(true);
  mocks.drain.mockResolvedValue({
    claimed: 1,
    processed: 0,
    deferred: 1,
    blocked: 0,
  });
});
it('uses existing restricted readiness and one bounded leased receipt, with no financial provider adapter', async () => {
  expect(await primaryWalletBankInboxCli(['--readiness'], fixture.env)).toEqual(
    { ready: true }
  );
  expect(mocks.drain).not.toHaveBeenCalled();
  expect(await primaryWalletBankInboxCli(['--once'], fixture.env)).toEqual({
    claimed: 1,
    processed: 0,
    deferred: 1,
    blocked: 0,
  });
  expect(mocks.drain).toHaveBeenCalledWith({
    env: fixture.env,
    signal: expect.any(AbortSignal),
    batchSize: 1,
  });
});
it('rejects unknown actions or disabled capability without claiming any receipt', async () => {
  await expect(
    primaryWalletBankInboxCli(['--transfer'], fixture.env)
  ).rejects.toThrow('Usage');
  await expect(
    primaryWalletBankInboxCli(['--once'], { NODE_ENV: 'test' })
  ).rejects.toThrow('disabled');
  await expect(
    primaryWalletBankInboxCli(['--once', '--readiness'], fixture.env)
  ).rejects.toThrow('Usage');
  expect(mocks.readiness).not.toHaveBeenCalled();
  expect(mocks.drain).not.toHaveBeenCalled();
});
it('propagates rejected readiness and removes both signal listeners without claiming receipts', async () => {
  const interruptListeners = process.listenerCount('SIGINT');
  const terminationListeners = process.listenerCount('SIGTERM');
  mocks.readiness.mockRejectedValueOnce(new Error('readiness unavailable'));
  await expect(
    primaryWalletBankInboxCli(['--readiness'], fixture.env)
  ).rejects.toThrow('readiness unavailable');
  expect(mocks.drain).not.toHaveBeenCalled();
  expect(process.listenerCount('SIGINT')).toBe(interruptListeners);
  expect(process.listenerCount('SIGTERM')).toBe(terminationListeners);
});
it('reports an offline plan without touching readiness, drain or configuration', async () => {
  const planned = await primaryWalletBankInboxCli(['--plan'], {
    NODE_ENV: 'test',
  });
  expect(planned).toEqual({
    plan: expect.stringContaining('Plan only: no database/provider operations'),
  });
  expect(mocks.readiness).not.toHaveBeenCalled();
  expect(mocks.drain).not.toHaveBeenCalled();
});
it('propagates operational failure and removes signal listeners', async () => {
  const listeners = process.listenerCount('SIGTERM');
  mocks.drain.mockRejectedValueOnce(new Error('signing key unavailable'));
  await expect(
    primaryWalletBankInboxCli(['--once'], fixture.env)
  ).rejects.toThrow('signing key unavailable');
  expect(process.listenerCount('SIGTERM')).toBe(listeners);
});

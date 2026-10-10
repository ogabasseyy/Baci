import { beforeEach, expect, it, vi } from 'vitest';
import { runPrimaryWalletPaidInterestInboxCli } from './primary-wallet-paid-interest-inbox-worker-cli';

const mocks = vi.hoisted(() => ({ drain: vi.fn(), inbox: vi.fn(), bridge: vi.fn(), readiness: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/piggyvest/primary-wallet-paid-interest-inbox-worker', () => ({ drainPrimaryWalletPaidInterestInbox: mocks.drain }));
vi.mock('@/lib/piggyvest/primary-wallet-paid-interest-inbox-runtime', () => ({ readPrimaryWalletPaidInterestInboxRuntime: mocks.inbox }));
vi.mock('@/lib/piggyvest/primary-wallet-paid-interest-runtime', () => ({ readPrimaryWalletPaidInterestRuntime: mocks.bridge }));
vi.mock('@/lib/piggyvest/primary-wallet-paid-interest-inbox-store', () => ({ createPrimaryWalletPaidInterestInboxStore: () => ({ readiness: mocks.readiness }) }));
beforeEach(() => { vi.clearAllMocks(); mocks.inbox.mockReturnValue({}); mocks.bridge.mockReturnValue({}); mocks.readiness.mockResolvedValue(true); mocks.drain.mockResolvedValue({ claimed: 1, processed: 0, deferred: 1, quarantined: 0 }); });
it('runs plan without configuration, database or provider actions', async () => {
  const write = vi.fn();
  expect(await runPrimaryWalletPaidInterestInboxCli({ argv: ['--plan'], write })).toBe(0);
  expect(mocks.inbox).not.toHaveBeenCalled(); expect(mocks.bridge).not.toHaveBeenCalled(); expect(mocks.drain).not.toHaveBeenCalled();
});
it.each([{ argv: [] }, { argv: ['--once', '--plan'] }, { argv: ['--unknown'] }])('rejects invalid launch arguments without claiming receipts', async ({ argv }) => {
  expect(await runPrimaryWalletPaidInterestInboxCli({ argv, write: vi.fn() })).toBe(1);
  expect(mocks.drain).not.toHaveBeenCalled();
});
it('requires explicit owner-approved worker config before any claim', async () => {
  expect(await runPrimaryWalletPaidInterestInboxCli({ argv: ['--once'], env: { NODE_ENV: 'test' }, write: vi.fn() })).toBe(1);
  expect(mocks.drain).not.toHaveBeenCalled();
});
it('launches at most one receipt with bounded runtime and no financial/customer logs', async () => {
  const env = { NODE_ENV: 'test' as const, PIGGYVEST_PRIMARY_PAID_INTEREST_WORKER_APPROVED: 'true' };
  const write = vi.fn();
  expect(await runPrimaryWalletPaidInterestInboxCli({ argv: ['--once'], env, write })).toBe(0);
  expect(mocks.drain).toHaveBeenCalledWith({ env, batchSize: 1, signal: expect.any(AbortSignal) });
  expect(write).toHaveBeenCalledWith('{"claimed":1,"processed":0,"deferred":1,"quarantined":0}');
});
it('redacts runtime errors and never implies processed evidence on failure', async () => {
  mocks.drain.mockRejectedValue(new Error('secret financial diagnostic'));
  const write = vi.fn();
  expect(await runPrimaryWalletPaidInterestInboxCli({ argv: ['--once'], env: { NODE_ENV: 'test', PIGGYVEST_PRIMARY_PAID_INTEREST_WORKER_APPROVED: 'true' }, write })).toBe(1);
  expect(write).toHaveBeenCalledWith('Primary paid-interest worker unavailable; durable receipts remain retryable or quarantined.');
});
it('checks restricted database readiness without claiming or crediting receipts', async () => {
  const write = vi.fn();
  expect(await runPrimaryWalletPaidInterestInboxCli({ argv: ['--readiness'], env: { NODE_ENV: 'test', PIGGYVEST_PRIMARY_PAID_INTEREST_WORKER_APPROVED: 'true' }, write })).toBe(0);
  expect(mocks.readiness).toHaveBeenCalledOnce(); expect(mocks.drain).not.toHaveBeenCalled();
  expect(write).toHaveBeenCalledWith('{"ready":true,"financialActions":false}');
});

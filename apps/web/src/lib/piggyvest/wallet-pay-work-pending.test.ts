import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isWalletPayWorkPending } from './wallet-pay-work-pending';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ runtime: vi.fn(), listWork: vi.fn() }));
vi.mock('./primary-wallet-savings-runtime', () => ({
  readPrimaryWalletSavingsRecoveryRuntime: mocks.runtime,
}));
vi.mock('./primary-wallet-savings-executor', () => ({
  createPrimaryWalletSavingsExecutor: () => vi.fn(),
}));
vi.mock('./wallet-pay-store', () => ({
  createWalletPayWorkerStore: () => ({ listWork: mocks.listWork }),
}));

const none = { settle: [], refund: [], deliver: [] };
const env = {
  NODE_ENV: 'test',
  PIGGYVEST_PRIMARY_AUTHORIZER_DB_PASSWORD: 'set',
} as NodeJS.ProcessEnv;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.runtime.mockReturnValue({
    configuration: { integrationId: 'i', environment: 'production' },
  });
});

describe('isWalletPayWorkPending', () => {
  it('is false when PiggyVest savings was never installed', async () => {
    await expect(isWalletPayWorkPending({} as NodeJS.ProcessEnv)).resolves.toBe(
      false
    );
    expect(mocks.runtime).not.toHaveBeenCalled();
  });

  it('bugfix: throws for a broken (partly removed) savings setting, never "no work" (Codex P2)', async () => {
    mocks.runtime.mockImplementation(() => {
      throw new Error('missing');
    });
    await expect(isWalletPayWorkPending(env)).rejects.toThrow('missing');
  });

  it('is false when nothing waits and true when any work waits', async () => {
    mocks.listWork.mockResolvedValueOnce(none);
    await expect(isWalletPayWorkPending(env)).resolves.toBe(false);
    mocks.listWork.mockResolvedValueOnce({ ...none, refund: ['r'] });
    await expect(isWalletPayWorkPending(env)).resolves.toBe(true);
  });

  it('throws when the work cannot be read (the caller pages)', async () => {
    mocks.listWork.mockRejectedValue(new Error('db down'));
    await expect(isWalletPayWorkPending(env)).rejects.toThrow('db down');
  });
});

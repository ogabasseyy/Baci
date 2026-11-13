import { afterEach, describe, expect, it, vi } from 'vitest';
import { readWalletPayRuntime } from '@/lib/piggyvest/wallet-pay-runtime';
import { createVtuWalletPayStepDeps } from './vtu-wallet-pay-step-deps';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/piggyvest/primary-wallet-identity', () => ({
  resolvePrimaryWalletIdentity: vi.fn(),
}));
vi.mock('@/lib/piggyvest/wallet-pay-runtime', () => ({
  readWalletPayRuntime: vi.fn(),
  readWalletPayRecoveryRuntime: vi.fn(),
}));
vi.mock('@/lib/piggyvest/wallet-pay-service', () => ({}));

const deps = (rpc: ReturnType<typeof vi.fn>) =>
  createVtuWalletPayStepDeps({ supabase: { rpc } as never, user: {} as never });

describe('createVtuWalletPayStepDeps.readPurchase', () => {
  it('reads the caller own purchase through the owner-scoped RPC', async () => {
    const rpc = vi.fn(async () => ({
      data: [{ piggyvest_paid: true, amount: '1000.00' }],
      error: null,
    }));
    await expect(deps(rpc).readPurchase('txn-1')).resolves.toEqual({
      piggyvestPaid: true,
      amount: 1000,
    });
    expect(rpc).toHaveBeenCalledWith('get_vtu_wallet_pay_purchase', {
      p_transaction_id: 'txn-1',
    });
  });

  it('answers null for a purchase the caller can not see, and throws on errors', async () => {
    await expect(
      deps(vi.fn(async () => ({ data: [], error: null }))).readPurchase('txn-1')
    ).resolves.toBeNull();
    await expect(
      deps(
        vi.fn(async () => ({ data: null, error: { message: 'x' } }))
      ).readPurchase('txn-1')
    ).rejects.toThrow();
  });
});

describe('bugfix: switching on IMEI wallet pay also switched on airtime/data/bills (Codex P2)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('starts no new utilities payment without its own switch', () => {
    vi.mocked(readWalletPayRuntime).mockReturnValue({ tag: 'live' } as never);
    vi.stubEnv('PIGGYVEST_WALLET_PAY_UTILITIES_ENABLED', '');
    expect(deps(vi.fn()).readRuntime()).toBeNull();
    vi.stubEnv('PIGGYVEST_WALLET_PAY_UTILITIES_ENABLED', 'true');
    expect(deps(vi.fn()).readRuntime()).toEqual({ tag: 'live' });
  });
});

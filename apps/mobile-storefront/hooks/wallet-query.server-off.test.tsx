import { describe, expect, it } from '@jest/globals';
import type { WalletActiveSavingsGoal, WalletData } from './wallet-query';
import { walletKeys } from './wallet-query';

// The wallet query contract stays additive: a wallet the server keeps off
// PiggyVest needs no primary field, and its cache keys are per identity.
describe('wallet query contract with the server off', () => {
  it('types a legacy wallet without any PiggyVest field', () => {
    const legacy: WalletData = { balance: 100, loyalty_points: 0 };
    expect(legacy.primary_balance_kobo).toBeUndefined();
  });

  it('keys wallet data by owner and merchant, with an optional user pin', () => {
    const key = walletKeys.data({ merchantId: 'm1', ownerId: 'o1' });
    expect(key).toEqual(['wallet', 'data', 'v4', 'o1', 'm1']);
    expect(
      walletKeys.data({ merchantId: 'm1', ownerId: 'o1', userId: 'u1' })
    ).toEqual(['wallet', 'data', 'v4', 'o1', 'm1', 'u1']);
  });

  it('refuses keys without a merchant or owner instead of sharing a cache', () => {
    expect(() => walletKeys.data({ merchantId: '', ownerId: 'o1' })).toThrow();
    expect(() => walletKeys.data({ merchantId: 'm1', ownerId: '' })).toThrow();
    expect(() => walletKeys.transactions('')).toThrow();
  });

  it('a goal without principal_amount (no PiggyVest data) is a valid goal shape', () => {
    const goal: WalletActiveSavingsGoal = {
      contribution_amount: 1,
      contribution_frequency: 'weekly',
      current_amount: 10,
      id: 'g',
      maturity_date: '2026-12-01',
      source_mode: 'manual',
      status: 'active',
      target_amount: 100,
      title: 'Plan',
    };
    expect(goal.principal_amount).toBeUndefined();
    expect(walletKeys.all).toBeDefined();
  });
});

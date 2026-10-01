import { describe, expect, it } from 'vitest';
import { walletActionConfig } from './wallet-action-config';

describe('walletActionConfig', () => {
  it('defines limits that protect withdrawals and transaction history', () => {
    expect(walletActionConfig.minimumWithdrawalAmount).toBeGreaterThan(0);
    expect(walletActionConfig.maxTransactionLimit).toBeGreaterThan(0);
  });

  it('permits each calendar day as a payout day', () => {
    expect(walletActionConfig.validPayoutDays).toEqual([
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ]);
  });
});

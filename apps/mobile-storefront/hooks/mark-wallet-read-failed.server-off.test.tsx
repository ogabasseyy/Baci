import { describe, expect, it } from '@jest/globals';
import { markWalletReadFailed } from './mark-wallet-read-failed';
import type { WalletQueryData } from './wallet-query';

function load(wallet: Record<string, unknown>): WalletQueryData {
  return {
    transactions: [],
    wallet: { balance: 0, loyalty_points: 0, ...wallet },
  } as WalletQueryData;
}
const failedPull = {
  dataUpdatedAt: 1_000,
  errorUpdatedAt: 2_000,
  failureCount: 0,
};

describe('markWalletReadFailed with the server keeping PiggyVest off', () => {
  it('leaves a legacy wallet exactly as loaded after a failed read', () => {
    const data = load({ balance: 500 });
    expect(markWalletReadFailed(data, failedPull)).toBe(data);
  });

  it('leaves a PiggyVest wallet alone while its reads succeed', () => {
    const data = load({ primary_balance_kobo: 500_000 });
    expect(
      markWalletReadFailed(data, {
        dataUpdatedAt: 2_000,
        errorUpdatedAt: 1_000,
        failureCount: 0,
      })
    ).toBe(data);
  });
});

describe('bugfix: a failed pull-to-refresh showed no last-known hint (walk 15)', () => {
  it('marks the shown balance as last known after a failed re-read', () => {
    const marked = markWalletReadFailed(
      load({ primary_balance_kobo: 500_000 }),
      failedPull
    );
    expect(marked?.wallet.primary_stale).toBe(true);
    expect(marked?.wallet.primary_balance_kobo).toBe(500_000);
  });

  it('marks it while a re-read is still retrying after a failure', () => {
    const marked = markWalletReadFailed(load({ primary_balance_kobo: 0 }), {
      dataUpdatedAt: 2_000,
      errorUpdatedAt: 0,
      failureCount: 1,
    });
    expect(marked?.wallet.primary_stale).toBe(true);
  });
});

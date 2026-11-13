import { describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import type { WalletData } from '@/hooks/wallet-query';
import { usePrimaryWalletWatch } from './use-primary-wallet-watch';

jest.mock('react-native', () => ({ Alert: { alert: jest.fn() } }));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: { getState: () => ({ user: null }) },
}));

// The server keeping PiggyVest off never reports a primary balance: the
// wallet passes through untouched and nothing polls.
describe('primary wallet watch with the server off', () => {
  it('returns the legacy wallet unchanged and never refetches', () => {
    jest.useFakeTimers();
    const wallet: WalletData = { balance: 900, loyalty_points: 3 };
    const refetch = jest.fn();
    const { result } = renderHook(() =>
      usePrimaryWalletWatch({
        wallet,
        showFundPanel: true,
        scopeKey: 'u:m',
        refetch,
      })
    );
    expect(result.current).toBe(wallet);
    jest.advanceTimersByTime(60_000);
    expect(refetch).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});

describe('bugfix: pending PiggyVest account sheet never re-checks after a transfer', () => {
  it('refetches while the Add money sheet is open on a pending PiggyVest account', () => {
    // Arrange: PiggyVest account shown, balance still pending.
    jest.useFakeTimers();
    const wallet = {
      balance: 0,
      funding_account: {
        account_name: 'Ada Obi',
        account_number: '3685660013',
        bank_name: 'Provider Bank',
        provider: 'piggyvest',
      },
      loyalty_points: 0,
      primary_pending: true,
    } as WalletData;
    const refetch = jest.fn();
    renderHook(() =>
      usePrimaryWalletWatch({
        wallet,
        showFundPanel: true,
        scopeKey: 'u:m',
        refetch,
      })
    );

    // Act: a poll interval passes after the customer transfers.
    jest.advanceTimersByTime(10_000);

    // Assert: the wallet is re-read so the new balance can appear.
    expect(refetch).toHaveBeenCalled();
    jest.useRealTimers();
  });
});

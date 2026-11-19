import { describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import type { WalletData } from '@/hooks/wallet-query';
import { usePrimaryWalletWatch } from './use-primary-wallet-watch';

// The live verdict is unknown unless a test says otherwise.
let mockVerdict: boolean | null = null;
jest.mock('@/hooks/use-piggyvest-capability-now', () => ({
  usePiggyvestCapabilityNow: () => mockVerdict,
}));
jest.mock('@/lib/config', () => ({ CONFIG: { MERCHANT_ID: '' } }));
jest.mock('react-native', () => ({ Alert: { alert: jest.fn() } }));
jest.mock('./savings/notify-savings', () => ({ notifySavings: jest.fn() }));
jest.mock('@/stores/auth-store', () => {
  const state = { merchantId: null, user: null };
  const useAuthStore = (select: (s: typeof state) => unknown) => select(state);
  (useAuthStore as unknown as { getState: () => typeof state }).getState = () =>
    state;
  return { useAuthStore };
});

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

describe('bugfix: stale PiggyVest balance after a rollback', () => {
  it('returns the wallet without PiggyVest fields while PiggyVest is ruled out', () => {
    mockVerdict = false;
    const wallet = {
      balance: 900,
      loyalty_points: 0,
      primary_balance_kobo: 500_000,
    } as WalletData;
    const { result } = renderHook(() =>
      usePrimaryWalletWatch({
        wallet,
        showFundPanel: false,
        scopeKey: 'u:m',
        refetch: jest.fn(),
      })
    );
    mockVerdict = null;

    expect(result.current?.primary_balance_kobo).toBeUndefined();
    expect(result.current?.balance).toBe(900);
  });
});

describe('bugfix: rolled-back balance returns when the ruling-out expires', () => {
  it('keeps PiggyVest fields hidden through the unknown window until re-confirmed', () => {
    // Arrange: rolled back to "not ready"; the reload failed.
    const wallet = {
      balance: 900,
      loyalty_points: 0,
      primary_balance_kobo: 500_000,
    } as WalletData;
    mockVerdict = false;
    const { result, rerender } = renderHook(() =>
      usePrimaryWalletWatch({
        wallet,
        showFundPanel: false,
        scopeKey: 'u:m',
        refetch: jest.fn(),
      })
    );

    // Act: the ruling-out expires; the re-probe is pending (unknown).
    mockVerdict = null;
    rerender({});

    // Assert: still hidden.
    expect(result.current?.primary_balance_kobo).toBeUndefined();

    // A positive verdict re-confirms PiggyVest.
    mockVerdict = true;
    rerender({});
    expect(result.current?.primary_balance_kobo).toBe(500_000);
    mockVerdict = null;
  });
});

describe('bugfix: legacy wallet presented after a positive verdict', () => {
  it('shows a pending PiggyVest wallet and keeps re-checking after the reload fails', async () => {
    // Arrange: PiggyVest confirmed, the cached wallet still legacy-shaped,
    // and every reload fails (rejected refetch).
    jest.useFakeTimers();
    mockVerdict = true;
    const wallet: WalletData = { balance: 900, loyalty_points: 3 };
    const refetch = jest.fn(async () => {
      throw new Error('network down');
    });

    // Act
    const { result } = renderHook(() =>
      usePrimaryWalletWatch({
        wallet,
        showFundPanel: false,
        scopeKey: 'u:m',
        refetch,
      })
    );
    await jest.advanceTimersByTimeAsync(60_000);

    // Assert: never the old Total Balance view; the reload is retried.
    expect(result.current?.primary_pending).toBe(true);
    expect(result.current?.balance).toBe(900);
    expect(refetch).toHaveBeenCalled();
    mockVerdict = null;
    jest.useRealTimers();
  });

  it('leaves a ruled-out legacy wallet exactly as today', () => {
    mockVerdict = false;
    const wallet: WalletData = { balance: 900, loyalty_points: 3 };
    const { result } = renderHook(() =>
      usePrimaryWalletWatch({
        wallet,
        showFundPanel: false,
        scopeKey: 'u:m',
        refetch: jest.fn(),
      })
    );
    expect(result.current?.primary_pending).toBeUndefined();
    mockVerdict = null;
  });
});

describe('bugfix: ruled-out suppression carried into a new wallet scope', () => {
  it('shows the new scope PiggyVest balance while its verdict is unknown', () => {
    // Arrange: the first scope was ruled out, so PiggyVest is suppressed.
    mockVerdict = false;
    const primaryWallet = {
      balance: 900,
      loyalty_points: 3,
      primary_balance_kobo: 500_000,
    } as WalletData;
    const { result, rerender } = renderHook(
      ({ scopeKey }: { scopeKey: string }) =>
        usePrimaryWalletWatch({
          wallet: primaryWallet,
          showFundPanel: false,
          scopeKey,
          refetch: jest.fn(),
        }),
      { initialProps: { scopeKey: 'u1:legacy' } }
    );
    expect(result.current?.primary_balance_kobo).toBeUndefined();

    // Act: switch to a pilot scope whose verdict is still unknown.
    mockVerdict = null;
    rerender({ scopeKey: 'u1:pilot' });

    // Assert: its PiggyVest balance is not stripped by the old scope.
    expect(result.current?.primary_balance_kobo).toBe(500_000);
  });
});

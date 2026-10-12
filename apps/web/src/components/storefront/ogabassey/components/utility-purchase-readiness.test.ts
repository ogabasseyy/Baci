import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockToast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ toast: mockToast }));

import type { CustomerUser } from '@/contexts/customer-auth-context';
import { checkUtilityPurchaseReadiness } from './utility-purchase-readiness';

const user = { id: 'user-1', email: 'a@b.c' } as unknown as CustomerUser;

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    amount: 1000,
    canFundByBankTransfer: true,
    isAuthLoading: false,
    isAuthenticated: true,
    merchantId: 'merchant-1',
    refreshWallet: vi.fn(),
    user,
    walletBalance: 5000,
    walletError: false,
    walletLoading: false,
    walletRefreshPending: false,
    ...overrides,
  };
}

describe('checkUtilityPurchaseReadiness', () => {
  beforeEach(() => {
    mockToast.mockReset();
  });

  it('proceeds when session and wallet are settled and funded', () => {
    expect(checkUtilityPurchaseReadiness(baseInput())).toBe(true);
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('blocks while a wallet refresh is pending even when loading is false', () => {
    // Commit/effect race: refreshWallet() ran but the fetch effect
    // has not flipped walletLoading yet — the balance is stale.
    expect(
      checkUtilityPurchaseReadiness(
        baseInput({ walletLoading: false, walletRefreshPending: true })
      )
    ).toBe(false);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Checking wallet balance' })
    );
  });

  it('blocks while auth is loading', () => {
    expect(
      checkUtilityPurchaseReadiness(baseInput({ isAuthLoading: true }))
    ).toBe(false);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Checking account' })
    );
  });

  it('blocks signed-out customers', () => {
    expect(
      checkUtilityPurchaseReadiness(
        baseInput({ isAuthenticated: false, user: null })
      )
    ).toBe(false);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Sign in required' })
    );
  });

  it('blocks while the merchant ID is hydrating (scope would split)', () => {
    // A submit scoped under '' followed by a post-hydration retry
    // would miss recall, mint fresh, and debit twice.
    expect(
      checkUtilityPurchaseReadiness(baseInput({ merchantId: undefined }))
    ).toBe(false);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Store unavailable' })
    );
  });

  it('blocks while the wallet is loading (never as insufficient funds)', () => {
    expect(
      checkUtilityPurchaseReadiness(
        baseInput({ walletLoading: true, walletBalance: 0 })
      )
    ).toBe(false);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Checking wallet balance' })
    );
  });

  it('blocks on wallet error and retries the fetch', () => {
    const refreshWallet = vi.fn();
    expect(
      checkUtilityPurchaseReadiness(
        baseInput({ walletError: true, refreshWallet })
      )
    ).toBe(false);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Wallet unavailable' })
    );
    expect(refreshWallet).toHaveBeenCalledTimes(1);
  });

  it('blocks shortfalls with the funding-panel callback', () => {
    const onInsufficientWalletBalance = vi.fn();
    expect(
      checkUtilityPurchaseReadiness(
        baseInput({ walletBalance: 400, onInsufficientWalletBalance })
      )
    ).toBe(false);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Insufficient wallet balance',
        description:
          'Fund your wallet with at least ₦600 more to complete this purchase.',
      })
    );
    expect(onInsufficientWalletBalance).toHaveBeenCalledTimes(1);
  });

  it('says top-up is unavailable when the store has no funding rail', () => {
    expect(
      checkUtilityPurchaseReadiness(
        baseInput({ walletBalance: 400, canFundByBankTransfer: false })
      )
    ).toBe(false);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description:
          "Your wallet balance of ₦400 is ₦600 short. Wallet top-up isn't available for this store.",
      })
    );
  });
});

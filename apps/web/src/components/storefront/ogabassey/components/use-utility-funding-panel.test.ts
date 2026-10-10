import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { StorefrontWalletFundingAccount } from '@baci/shared';
import { useUtilityFundingPanel } from './use-utility-funding-panel';

const fundingAccount = {
  accountNumber: '9099887766',
} as unknown as StorefrontWalletFundingAccount;

const eligibleProps = {
  fundingAccount: null,
  isAuthenticated: true,
  merchantSlug: 'ogabassey',
  requiresFundingAccountConsent: true,
  userId: 'user-1',
  walletDvaEnabled: true,
};

describe('useUtilityFundingPanel', () => {
  it('offers bank-transfer funding when the wallet API allows account creation', () => {
    const { result } = renderHook(() =>
      useUtilityFundingPanel(eligibleProps)
    );

    expect(result.current.canFundByBankTransfer).toBe(true);
    expect(result.current.showFundingPanel).toBe(false);
  });

  it('offers bank-transfer funding when an account already exists', () => {
    const { result } = renderHook(() =>
      useUtilityFundingPanel({
        ...eligibleProps,
        fundingAccount,
        requiresFundingAccountConsent: false,
      })
    );

    expect(result.current.canFundByBankTransfer).toBe(true);
  });

  it.each([
    ['unauthenticated', { isAuthenticated: false }],
    ['DVA disabled', { walletDvaEnabled: false }],
    [
      'no account and no creation path',
      { fundingAccount: null, requiresFundingAccountConsent: false },
    ],
  ])('withholds bank-transfer funding when %s', (_label, override) => {
    const { result } = renderHook(() =>
      useUtilityFundingPanel({ ...eligibleProps, ...override })
    );

    expect(result.current.canFundByBankTransfer).toBe(false);
  });

  it('opens the panel without auto-create on insufficient balance', () => {
    const { result } = renderHook(() =>
      useUtilityFundingPanel(eligibleProps)
    );

    act(() => {
      result.current.openForInsufficientBalance();
    });

    expect(result.current.showFundingPanel).toBe(true);
    expect(result.current.fundingPanelAutoCreate).toBe(false);
  });

  it('ignores insufficient-balance opens when funding is unavailable', () => {
    const { result } = renderHook(() =>
      useUtilityFundingPanel({
        ...eligibleProps,
        walletDvaEnabled: false,
      })
    );

    act(() => {
      result.current.openForInsufficientBalance();
    });

    expect(result.current.showFundingPanel).toBe(false);
  });

  it('treats the explicit bank-transfer choice as consent and toggles', () => {
    const { result } = renderHook(() =>
      useUtilityFundingPanel(eligibleProps)
    );

    act(() => {
      result.current.toggleFromExplicitChoice();
    });
    expect(result.current.showFundingPanel).toBe(true);
    expect(result.current.fundingPanelAutoCreate).toBe(true);

    act(() => {
      result.current.toggleFromExplicitChoice();
    });
    expect(result.current.showFundingPanel).toBe(false);

    // Consent flag survives the toggle; a later programmatic open still
    // re-arms it to false.
    act(() => {
      result.current.openForInsufficientBalance();
    });
    expect(result.current.fundingPanelAutoCreate).toBe(false);
  });

  it('collapses the panel on close', () => {
    const { result } = renderHook(() =>
      useUtilityFundingPanel(eligibleProps)
    );

    act(() => {
      result.current.toggleFromExplicitChoice();
    });
    expect(result.current.showFundingPanel).toBe(true);

    act(() => {
      result.current.closeFundingPanel();
    });
    expect(result.current.showFundingPanel).toBe(false);
  });

  it('collapses an open panel when the customer or merchant identity changes', () => {
    const { result, rerender } = renderHook(
      (props: typeof eligibleProps) => useUtilityFundingPanel(props),
      { initialProps: eligibleProps }
    );

    act(() => {
      result.current.toggleFromExplicitChoice();
    });
    expect(result.current.showFundingPanel).toBe(true);

    rerender({ ...eligibleProps, userId: 'user-2' });
    expect(result.current.showFundingPanel).toBe(false);

    act(() => {
      result.current.toggleFromExplicitChoice();
    });
    rerender({ ...eligibleProps, merchantSlug: 'other-store' });
    expect(result.current.showFundingPanel).toBe(false);
  });
});

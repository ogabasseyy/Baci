import { describe, expect, it, vi } from 'vitest';
import { applyUtilityPurchaseBalanceEffect } from './utility-purchase-balance';

function success(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'wallet-success',
    reference: 'REF-1',
    amount: 1000,
    processing: false,
    ...overrides,
  } as Parameters<typeof applyUtilityPurchaseBalanceEffect>[0]['result'];
}

function harness(overrides: Record<string, unknown> = {}) {
  const appliedReferences = new Set<string>();
  const refreshWallet = vi.fn();
  const setWalletBalance = vi.fn();
  return {
    appliedReferences,
    refreshWallet,
    setWalletBalance,
    run: (extra: Record<string, unknown> = {}) =>
      applyUtilityPurchaseBalanceEffect({
        appliedReferences,
        isAmbiguousReplay: false,
        refreshWallet,
        result: success(),
        setWalletBalance,
        submitAmount: 1000,
        submitBalance: 5000,
        ...overrides,
        ...extra,
      }),
  };
}

describe('applyUtilityPurchaseBalanceEffect', () => {
  it('refreshes for server truth on an ambiguous replay', () => {
    const h = harness({ isAmbiguousReplay: true });

    h.run();

    expect(h.refreshWallet).toHaveBeenCalledTimes(1);
    expect(h.setWalletBalance).not.toHaveBeenCalled();
    expect(h.appliedReferences.has('REF-1')).toBe(true);
  });

  it('decrements locally on a fresh success', () => {
    const h = harness();

    h.run();

    expect(h.setWalletBalance).toHaveBeenCalledTimes(1);
    const updater = h.setWalletBalance.mock.calls[0]?.[0] as (
      balance: number
    ) => number;
    // Untouched since submit: instant local decrement, no refresh.
    expect(updater(5000)).toBe(4000);
    expect(h.refreshWallet).not.toHaveBeenCalled();
    // Clamp at zero for a small untouched balance.
    const h2 = harness({ submitBalance: 200 });
    h2.run();
    const updater2 = h2.setWalletBalance.mock.calls[0]?.[0] as (
      balance: number
    ) => number;
    expect(updater2(200)).toBe(0);
  });

  it('refreshes instead of decrementing when state moved since submit', () => {
    // Codex R98 P2: a refresh that landed post-debit (or another
    // purchase) already moved state off the pre-submit generation —
    // decrementing again would double-count the debit.
    const h = harness();

    h.run();

    const updater = h.setWalletBalance.mock.calls[0]?.[0] as (
      balance: number
    ) => number;
    expect(updater(4000)).toBe(4000);
    expect(h.refreshWallet).toHaveBeenCalledTimes(1);
  });

  it('prefers the server cashback balance over the local decrement', () => {
    const h = harness();

    h.run({ result: success({ cashback: { newBalance: 4321 } }) });

    expect(h.setWalletBalance).toHaveBeenCalledWith(4321);
    expect(h.refreshWallet).not.toHaveBeenCalled();
  });

  it('defers the effect entirely while processing', () => {
    const h = harness();

    h.run({ result: success({ processing: true }) });

    expect(h.refreshWallet).not.toHaveBeenCalled();
    expect(h.setWalletBalance).not.toHaveBeenCalled();
    expect(h.appliedReferences.has('REF-1')).toBe(false);
  });

  it('applies the effect only once per reference', () => {
    const h = harness();

    h.run();
    h.run();

    expect(h.setWalletBalance).toHaveBeenCalledTimes(1);
  });
});

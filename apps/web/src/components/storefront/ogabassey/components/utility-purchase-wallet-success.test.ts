import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ toast: (...args: unknown[]) => mockToast(...args) }));
vi.mock('./utility-purchase-balance', () => ({
  applyUtilityPurchaseBalanceEffect: vi.fn(),
}));

import { applyUtilityPurchaseBalanceEffect } from './utility-purchase-balance';
import { applyUtilityWalletSuccessOutcome } from './utility-purchase-wallet-success';

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    activeTab: 'airtime',
    appliedReferences: new Set<string>(),
    attempt: { key: 'k', scoped: 'scoped-1', recalled: false },
    forgetScopedKey: vi.fn(),
    isScopedReplay: vi.fn().mockReturnValue(false),
    isScopedStale: vi.fn().mockReturnValue(false),
    markAttemptShown: vi.fn(),
    noteScopedReference: vi.fn(),
    clearIntent: vi.fn(),
    getCurrentBalance: () => 5000,
    refreshWallet: vi.fn(),
    result: {
      kind: 'wallet-success',
      reference: 'REF-1',
      amount: 500,
      processing: false,
    },
    setLoading: vi.fn(),
    setStep: vi.fn(),
    setSuccessAmount: vi.fn(),
    setTransactionRef: vi.fn(),
    setTransactionVoucherPin: vi.fn(),
    setWalletBalance: vi.fn(),
    submitAmount: 500,
    submitBalance: 5000,
    ...overrides,
  } as Parameters<typeof applyUtilityWalletSuccessOutcome>[0];
}

describe('applyUtilityWalletSuccessOutcome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('settles + presents a terminal success', () => {
    const input = baseInput();

    expect(applyUtilityWalletSuccessOutcome(input)).toBe(false);

    expect(input.forgetScopedKey).toHaveBeenCalledWith('scoped-1');
    expect(applyUtilityPurchaseBalanceEffect).toHaveBeenCalledOnce();
    expect(applyUtilityPurchaseBalanceEffect).toHaveBeenCalledWith(
      expect.objectContaining({ submitAmount: 500, submitBalance: 5000 })
    );
    expect(input.setTransactionRef).toHaveBeenCalledWith('REF-1');
    // Generation-bound settle (Codex R137 P1): the shown-mark
    // carries the key so a re-minted generation never inherits it.
    expect(input.markAttemptShown).toHaveBeenCalledWith('scoped-1', 'k');
    expect(input.setStep).toHaveBeenCalledWith('success');
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Purchase Successful' })
    );
  });

  it('keeps the key and shows processing for a 202', () => {
    const input = baseInput({
      result: {
        kind: 'wallet-success',
        reference: 'REF-2',
        amount: 500,
        processing: true,
      },
    });

    expect(applyUtilityWalletSuccessOutcome(input)).toBe(false);

    expect(input.forgetScopedKey).not.toHaveBeenCalled();
    expect(input.noteScopedReference).toHaveBeenCalledWith(
      'scoped-1',
      'REF-2'
    );
    expect(input.setStep).toHaveBeenCalledWith('processing');
  });

  it('stops on a stale replay after forgetting + explaining', () => {
    const input = baseInput();
    vi.mocked(input.isScopedStale).mockReturnValue(true);

    expect(applyUtilityWalletSuccessOutcome(input)).toBe(true);

    expect(input.forgetScopedKey).toHaveBeenCalledWith('scoped-1');
    expect(input.setLoading).toHaveBeenCalledWith(false);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Purchase Already Completed' })
    );
    expect(input.setStep).not.toHaveBeenCalled();
    expect(applyUtilityPurchaseBalanceEffect).not.toHaveBeenCalled();
  });
});

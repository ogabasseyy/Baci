import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));
vi.mock('@/contexts/customer-live-identity', () => ({
  hasUtilityPurchaseIdentityMoved: vi.fn(),
}));
vi.mock('./use-utility-idempotency-key', () => ({
  finalizeSuppressedAttempt: vi.fn(),
  shouldRotateVtuKeyForStatus: vi.fn(),
}));
vi.mock('./utility-purchase-wallet-success', () => ({
  applyUtilityWalletSuccessOutcome: vi.fn(),
}));

import { hasUtilityPurchaseIdentityMoved } from '@/contexts/customer-live-identity';
import {
  finalizeSuppressedAttempt,
  shouldRotateVtuKeyForStatus,
} from './use-utility-idempotency-key';
import {
  settleUtilityPurchaseResult,
  type SettleUtilityPurchaseResultInput,
  type UtilityPurchaseSubmitter,
} from './utility-purchase-result-settlement';
import { applyUtilityWalletSuccessOutcome } from './utility-purchase-wallet-success';

const submitter: UtilityPurchaseSubmitter = {
  customerId: 'customer-1',
  merchantSlug: 'ogabassey',
  userId: 'user-1',
};

function baseInput(
  overrides: Record<string, unknown> = {}
): SettleUtilityPurchaseResultInput {
  return {
    activeTab: 'airtime',
    appliedReferences: new Set<string>(),
    attempt: { key: 'k', scoped: 'scoped-1', recalled: false },
    clearIntent: vi.fn(),
    forgetScopedKey: vi.fn(),
    isResultViewActive: () => true,
    isScopedReplay: vi.fn(),
    isScopedStale: vi.fn(),
    markAttemptShown: vi.fn(),
    noteScopedReference: vi.fn(),
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
    submitter,
    ...overrides,
  };
}

describe('settleUtilityPurchaseResult', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasUtilityPurchaseIdentityMoved).mockReturnValue(false);
  });

  it('preserves the attempt when the view closed mid-flight', () => {
    const input = baseInput({ isResultViewActive: () => false });

    settleUtilityPurchaseResult(input);

    expect(finalizeSuppressedAttempt).toHaveBeenCalledWith(
      input.attempt,
      input.result
    );
    expect(applyUtilityWalletSuccessOutcome).not.toHaveBeenCalled();
    expect(input.setLoading).not.toHaveBeenCalled();
  });

  it('discards the result when identity moved mid-flight', () => {
    vi.mocked(hasUtilityPurchaseIdentityMoved).mockReturnValue(true);
    const input = baseInput();

    settleUtilityPurchaseResult(input);

    expect(hasUtilityPurchaseIdentityMoved).toHaveBeenCalledWith(submitter);
    expect(finalizeSuppressedAttempt).toHaveBeenCalledWith(
      input.attempt,
      input.result
    );
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Account changed',
      description:
        'The signed-in account changed while the purchase was processing. The result was discarded.',
    });
    expect(applyUtilityWalletSuccessOutcome).not.toHaveBeenCalled();
    expect(input.setLoading).toHaveBeenCalledWith(false);
  });

  it('delegates wallet-success to the outcome helper', () => {
    vi.mocked(applyUtilityWalletSuccessOutcome).mockReturnValue(false);
    const input = baseInput();

    settleUtilityPurchaseResult(input);

    expect(applyUtilityWalletSuccessOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        result: input.result,
        submitAmount: 500,
        submitBalance: 5000,
      })
    );
    expect(input.setLoading).toHaveBeenCalledWith(false);
  });

  it('rotates the key and toasts on errors per status', () => {
    vi.mocked(shouldRotateVtuKeyForStatus).mockReturnValue(true);
    const input = baseInput({
      result: { kind: 'error', message: 'Bad', status: 400 },
    });

    settleUtilityPurchaseResult(input);

    expect(input.forgetScopedKey).toHaveBeenCalledWith('scoped-1');
    expect(input.refreshWallet).toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Transaction Failed',
      description: 'Bad',
      variant: 'destructive',
    });
    expect(input.setLoading).toHaveBeenCalledWith(false);
  });
});

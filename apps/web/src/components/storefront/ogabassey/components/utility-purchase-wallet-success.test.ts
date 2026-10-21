import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ toast: (...args: unknown[]) => mockToast(...args) }));
vi.mock('./utility-purchase-balance', () => ({
  applyUtilityPurchaseBalanceEffect: vi.fn(),
}));
vi.mock('./utility-pending-idempotency', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  forgetPendingVtuPurchaseDurable: vi.fn(),
}));

import { applyUtilityPurchaseBalanceEffect } from './utility-purchase-balance';
import {
  clearPendingVtuKeys,
  forgetPendingVtuPurchaseDurable,
  rememberPendingVtuPurchase,
} from './utility-pending-idempotency';
import { scopePendingVtuSignature } from './utility-pending-vtu-scope';
import { savePendingVtuSnapshot } from './utility-pending-idempotency-store';
import { pendingVtuPurchases } from './utility-pending-vtu-sync';
import { applyUtilityWalletSuccessOutcome } from './utility-purchase-wallet-success';

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    activeTab: 'airtime',
    appliedReferences: new Set<string>(),
    attempt: { key: 'k', scoped: 'scoped-1', recalled: false },
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
    clearPendingVtuKeys();
    vi.mocked(forgetPendingVtuPurchaseDurable).mockResolvedValue(true);
  });

  it('settles + presents a terminal success', async () => {
    const input = baseInput();

    await expect(applyUtilityWalletSuccessOutcome(input)).resolves.toBe(false);

    expect(forgetPendingVtuPurchaseDurable).toHaveBeenCalledWith('scoped-1');
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

  it('keeps the key and shows processing for a 202', async () => {
    rememberPendingVtuPurchase('scoped-1', 'k');
    const input = baseInput({
      result: {
        kind: 'wallet-success',
        reference: 'REF-2',
        amount: 500,
        processing: true,
      },
    });

    await expect(applyUtilityWalletSuccessOutcome(input)).resolves.toBe(false);

    expect(forgetPendingVtuPurchaseDurable).not.toHaveBeenCalled();
    expect(input.noteScopedReference).toHaveBeenCalledWith(
      'scoped-1',
      'REF-2'
    );
    expect(input.setStep).toHaveBeenCalledWith('processing');
  });

  it('skips the processing note when a sibling persisted a newer generation', async () => {
    // Codex P1: noting on the stale entry would flush it back over
    // the newer persisted generation (memory-wins) — skip the note
    // and converge memory to the newer generation instead.
    const scoped = scopePendingVtuSignature(
      'user-note-veto',
      'merchant-1',
      '{"note-veto":true}'
    );
    rememberPendingVtuPurchase(scoped, 'key-old');
    const live = pendingVtuPurchases.get(scoped);
    expect(
      savePendingVtuSnapshot(
        JSON.stringify({
          entries: [
            [
              scoped,
              {
                key: 'key-new',
                reference: null,
                rememberedAt: (live?.rememberedAt ?? 0) + 1000,
                completedAt: null,
              },
            ],
          ],
          forgotten: [],
        })
      )
    ).toBe(true);
    const input = baseInput({
      attempt: { key: 'key-old', scoped, recalled: false },
      result: {
        kind: 'wallet-success',
        reference: 'REF-STALE',
        amount: 500,
        processing: true,
      },
    });

    await expect(applyUtilityWalletSuccessOutcome(input)).resolves.toBe(false);

    expect(input.noteScopedReference).not.toHaveBeenCalled();
    expect(pendingVtuPurchases.get(scoped)?.key).toBe('key-new');
  });

  it('stops on a stale replay after forgetting + explaining', async () => {
    const input = baseInput();
    vi.mocked(input.isScopedStale).mockReturnValue(true);

    await expect(applyUtilityWalletSuccessOutcome(input)).resolves.toBe(true);

    expect(forgetPendingVtuPurchaseDurable).toHaveBeenCalledWith('scoped-1');
    expect(input.setLoading).toHaveBeenCalledWith(false);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Purchase Already Completed' })
    );
    expect(input.setStep).not.toHaveBeenCalled();
    expect(applyUtilityPurchaseBalanceEffect).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  processNextRedvaultRefund,
  reconcileNextRedvaultRefund,
} from './redvault-refund-orchestrator';

const claimed = {
  amountKobo: 9_500,
  attemptReference: 'RV-original-capture',
  id: 'refund-1',
  providerReference: null,
  providerStatus: null,
  state: 'processing' as const,
};

describe('REDVAULT refund operator worker', () => {
  it('resolves a claim with no provider reference through the capture reference', async () => {
    const lookup = vi.fn();
    const lookupByCaptureReference = vi
      .fn()
      .mockResolvedValue({ kind: 'pending', providerStatus: 'pending' });
    const reconcile = vi
      .fn()
      .mockResolvedValue({ ...claimed, state: 'processing' });

    await expect(
      reconcileNextRedvaultRefund({
        provider: { lookup, lookupByCaptureReference },
        store: {
          claimNextReconciliation: vi.fn().mockResolvedValue({
            reconciliationClaimToken: 'claim-1',
            refund: claimed,
          }),
          reconcile,
        },
      })
    ).resolves.toEqual({
      kind: 'pending',
      refund: { ...claimed, state: 'processing' },
    });
    expect(lookup).not.toHaveBeenCalled();
    expect(lookupByCaptureReference).toHaveBeenCalledWith({
      captureReference: claimed.attemptReference,
      expectedAmountKobo: claimed.amountKobo,
      expectedCurrency: 'NGN',
    });
    expect(reconcile).toHaveBeenCalledWith({
      id: claimed.id,
      providerStatus: 'pending',
      reconciliationClaimToken: 'claim-1',
    });
  });

  it('does not resend a response-loss refund after its durable processing claim', async () => {
    const provider = {
      submit: vi.fn().mockRejectedValue(new Error('timeout')),
    };
    const finish = vi.fn();
    await expect(
      processNextRedvaultRefund({
        provider,
        store: {
          claimNext: vi.fn().mockResolvedValue(claimed),
          finish,
          recordProviderSubmission: vi.fn(),
          markSubmissionIndeterminate: vi
            .fn()
            .mockResolvedValue({ ...claimed, state: 'needs_reconciliation' }),
        },
      })
    ).resolves.toEqual({
      kind: 'indeterminate',
      refund: { ...claimed, state: 'needs_reconciliation' },
    });
    expect(provider.submit).toHaveBeenCalledOnce();
    expect(finish).not.toHaveBeenCalled();
  });

  it('records provider processing separately from customer receipt confirmation', async () => {
    const finish = vi
      .fn()
      .mockResolvedValue({ ...claimed, state: 'processed' });
    const recordProviderSubmission = vi.fn().mockResolvedValue({
      ...claimed,
      providerReference: 'provider-refund-1',
      providerStatus: 'processed',
    });
    await expect(
      processNextRedvaultRefund({
        provider: {
          submit: vi.fn().mockResolvedValue({
            kind: 'processed',
            providerReference: 'provider-refund-1',
            providerStatus: 'processed',
          }),
        },
        store: {
          claimNext: vi.fn().mockResolvedValue(claimed),
          finish,
          recordProviderSubmission,
          markSubmissionIndeterminate: vi
            .fn()
            .mockResolvedValue({ ...claimed, state: 'needs_reconciliation' }),
        },
      })
    ).resolves.toMatchObject({
      kind: 'processed',
      refund: { state: 'processed' },
    });
    // The provider reference must be persisted before finalization so a
    // finalizer failure still leaves the row recoverable by reconciliation.
    expect(recordProviderSubmission).toHaveBeenCalledWith({
      id: 'refund-1',
      providerReference: 'provider-refund-1',
      providerStatus: 'processed',
    });
    expect(finish).toHaveBeenCalledWith({
      id: 'refund-1',
      outcome: 'processed',
      providerReference: 'provider-refund-1',
      providerStatus: 'processed',
    });
    expect(recordProviderSubmission.mock.invocationCallOrder[0]).toBeLessThan(
      finish.mock.invocationCallOrder[0]
    );
  });

  it('persists an accepted pending provider refund id before reconciliation', async () => {
    const recordProviderSubmission = vi.fn().mockResolvedValue({
      ...claimed,
      providerReference: 'provider-refund-1',
      providerStatus: 'pending',
    });
    await expect(
      processNextRedvaultRefund({
        provider: {
          submit: vi.fn().mockResolvedValue({
            kind: 'accepted_pending',
            providerReference: 'provider-refund-1',
            providerStatus: 'pending',
          }),
        },
        store: {
          claimNext: vi.fn().mockResolvedValue(claimed),
          finish: vi.fn(),
          recordProviderSubmission,
          markSubmissionIndeterminate: vi.fn(),
        },
      })
    ).resolves.toMatchObject({
      kind: 'indeterminate',
      refund: { providerReference: 'provider-refund-1', state: 'processing' },
    });
    expect(recordProviderSubmission).toHaveBeenCalledWith({
      id: 'refund-1',
      providerReference: 'provider-refund-1',
      providerStatus: 'pending',
    });
  });

  it('reconciles a known provider id to processed without submitting another refund', async () => {
    const lookup = vi.fn().mockResolvedValue({
      kind: 'processed',
      providerStatus: 'processed',
    });
    const lookupByCaptureReference = vi.fn();
    const reconcile = vi.fn().mockResolvedValue({
      ...claimed,
      providerReference: 'provider-refund-1',
      providerStatus: 'processed',
      state: 'processed',
    });
    await expect(
      reconcileNextRedvaultRefund({
        provider: { lookup, lookupByCaptureReference },
        store: {
          claimNextReconciliation: vi.fn().mockResolvedValue({
            reconciliationClaimToken: 'claim-1',
            refund: { ...claimed, providerReference: 'provider-refund-1' },
          }),
          reconcile,
        },
      })
    ).resolves.toMatchObject({
      kind: 'processed',
      refund: { state: 'processed' },
    });
    expect(lookup).toHaveBeenCalledWith({
      providerReference: 'provider-refund-1',
      expectedAmountKobo: 9500,
      expectedCaptureReference: 'RV-original-capture',
      expectedCurrency: 'NGN',
    });
    expect(reconcile).toHaveBeenCalledWith({
      id: 'refund-1',
      providerStatus: 'processed',
      reconciliationClaimToken: 'claim-1',
    });
  });

  it('reconciles a trusted terminal failure without resubmitting', async () => {
    const reconcile = vi.fn().mockResolvedValue({
      ...claimed,
      providerReference: 'provider-refund-1',
      providerStatus: 'failed',
      state: 'failed',
    });
    await expect(
      reconcileNextRedvaultRefund({
        provider: {
          lookup: vi.fn().mockResolvedValue({
            kind: 'failed',
            providerStatus: 'failed',
          }),
          lookupByCaptureReference: vi.fn(),
        },
        store: {
          claimNextReconciliation: vi.fn().mockResolvedValue({
            reconciliationClaimToken: 'claim-1',
            refund: { ...claimed, providerReference: 'provider-refund-1' },
          }),
          reconcile,
        },
      })
    ).resolves.toMatchObject({ kind: 'failed', refund: { state: 'failed' } });
    expect(reconcile).toHaveBeenCalledWith({
      id: 'refund-1',
      providerStatus: 'failed',
      reconciliationClaimToken: 'claim-1',
    });
  });
});

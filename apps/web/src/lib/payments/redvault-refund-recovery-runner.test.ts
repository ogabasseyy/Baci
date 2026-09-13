import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REDVAULT_TEST_REFUND_APPLY_GUARD,
  runRedvaultRefundRecovery,
} from './redvault-refund-recovery-runner';

const logger = () => ({ error: vi.fn(), info: vi.fn() });

const provider = {
  lookup: vi.fn(),
  submit: vi.fn(),
};

const store = {
  claimNext: vi.fn(),
  claimNextReconciliation: vi.fn(),
  finish: vi.fn(),
  reconcile: vi.fn(),
  recordProviderSubmission: vi.fn(),
  markSubmissionIndeterminate: vi.fn(),
};

describe('REDVAULT refund recovery runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to a non-mutating dry run without calling storage or Paystack', async () => {
    const audit = logger();

    await expect(
      runRedvaultRefundRecovery({
        logger: audit,
        provider,
        providerEnvironment: 'test',
        store,
      })
    ).resolves.toEqual({ reconciliation: 'dry_run', submission: 'dry_run' });

    expect(provider.submit).not.toHaveBeenCalled();
    expect(provider.lookup).not.toHaveBeenCalled();
    expect(store.claimNext).not.toHaveBeenCalled();
    expect(store.claimNextReconciliation).not.toHaveBeenCalled();
  });

  it('does not mutate when an operator omits the explicit apply guard', async () => {
    const audit = logger();

    await expect(
      runRedvaultRefundRecovery({
        logger: audit,
        mode: 'apply',
        provider,
        providerEnvironment: 'test',
        store,
      })
    ).resolves.toEqual({
      reconciliation: 'apply_guard_required',
      submission: 'apply_guard_required',
    });

    expect(provider.submit).not.toHaveBeenCalled();
    expect(store.claimNext).not.toHaveBeenCalled();
    expect(audit.error).toHaveBeenCalledWith({
      event: 'redvault_refund_recovery',
      operation: 'apply',
      outcome: 'apply_guard_required',
    });
  });

  it('rejects an unknown runtime mode without implicitly applying refunds', async () => {
    const audit = logger();

    await expect(
      runRedvaultRefundRecovery({
        applyGuard: REDVAULT_TEST_REFUND_APPLY_GUARD,
        logger: audit,
        mode: 'apply-now',
        provider,
        providerEnvironment: 'test',
        store,
      })
    ).resolves.toEqual({
      reconciliation: 'invalid_mode',
      submission: 'invalid_mode',
    });

    expect(provider.submit).not.toHaveBeenCalled();
    expect(store.claimNext).not.toHaveBeenCalled();
  });

  it('submits once and reconciles only through injected test transports', async () => {
    const audit = logger();
    const refunded = {
      amountKobo: 9_500,
      attemptReference: 'capture-reference',
      id: 'refund-1',
      providerReference: null,
      providerStatus: null,
      state: 'processing' as const,
    };
    store.claimNext.mockResolvedValueOnce(refunded).mockResolvedValue(null);
    provider.submit.mockResolvedValueOnce({
      kind: 'accepted_pending',
      providerReference: '123',
      providerStatus: 'pending',
    });
    store.recordProviderSubmission.mockResolvedValueOnce({
      ...refunded,
      providerReference: '123',
    });
    store.claimNextReconciliation.mockResolvedValueOnce(null);

    await expect(
      runRedvaultRefundRecovery({
        applyGuard: REDVAULT_TEST_REFUND_APPLY_GUARD,
        logger: audit,
        mode: 'apply',
        provider,
        providerEnvironment: 'test',
        store,
      })
    ).resolves.toEqual({ reconciliation: 'idle', submission: 'indeterminate' });

    expect(provider.submit).toHaveBeenCalledOnce();
    expect(provider.lookup).not.toHaveBeenCalled();
    expect(store.recordProviderSubmission).toHaveBeenCalledWith({
      id: 'refund-1',
      providerReference: '123',
      providerStatus: 'pending',
    });
  });

  it('rejects a production provider declaration before any mutation', async () => {
    const audit = logger();

    await expect(
      runRedvaultRefundRecovery({
        applyGuard: REDVAULT_TEST_REFUND_APPLY_GUARD,
        logger: audit,
        mode: 'apply',
        provider,
        providerEnvironment: 'production',
        store,
      })
    ).resolves.toEqual({
      reconciliation: 'test_provider_required',
      submission: 'test_provider_required',
    });

    expect(provider.submit).not.toHaveBeenCalled();
    expect(provider.lookup).not.toHaveBeenCalled();
    expect(store.claimNext).not.toHaveBeenCalled();
  });

  it('passes the fenced reconciliation claim token to the durable store', async () => {
    const audit = logger();
    const refund = {
      amountKobo: 9_500,
      attemptReference: 'capture-reference',
      id: 'refund-1',
      providerReference: '123',
      providerStatus: 'pending',
      state: 'processing' as const,
    };
    store.claimNext.mockResolvedValueOnce(null);
    store.claimNextReconciliation.mockResolvedValueOnce({
      reconciliationClaimToken: 'fenced-claim-token',
      refund,
    });
    provider.lookup.mockResolvedValueOnce({
      kind: 'processed',
      providerStatus: 'processed',
    });
    store.reconcile.mockResolvedValueOnce({
      ...refund,
      providerStatus: 'processed',
      state: 'processed',
    });

    await expect(
      runRedvaultRefundRecovery({
        applyGuard: REDVAULT_TEST_REFUND_APPLY_GUARD,
        logger: audit,
        mode: 'apply',
        provider,
        providerEnvironment: 'test',
        store,
      })
    ).resolves.toEqual({ reconciliation: 'processed', submission: 'idle' });

    expect(store.reconcile).toHaveBeenCalledWith({
      id: 'refund-1',
      providerStatus: 'processed',
      reconciliationClaimToken: 'fenced-claim-token',
    });
  });

  it('logs a sanitized reconciliation failure without re-submitting a refund', async () => {
    const audit = logger();
    store.claimNext.mockResolvedValueOnce(null);
    store.claimNextReconciliation.mockResolvedValueOnce({
      reconciliationClaimToken: 'claim-1',
      refund: {
        amountKobo: 9_500,
        attemptReference: 'capture-reference',
        id: 'refund-1',
        providerReference: '123',
        providerStatus: 'pending',
        state: 'processing' as const,
      },
    });
    provider.lookup.mockRejectedValueOnce(new Error('provider secret detail'));

    await expect(
      runRedvaultRefundRecovery({
        applyGuard: REDVAULT_TEST_REFUND_APPLY_GUARD,
        logger: audit,
        mode: 'apply',
        provider,
        providerEnvironment: 'test',
        store,
      })
    ).resolves.toEqual({
      reconciliation: 'transport_or_provider_error',
      submission: 'idle',
    });

    expect(provider.submit).not.toHaveBeenCalled();
    expect(audit.error).toHaveBeenCalledWith({
      event: 'redvault_refund_recovery',
      operation: 'reconciliation',
      outcome: 'transport_or_provider_error',
    });
    expect(audit.error).not.toHaveBeenCalledWith(
      expect.objectContaining({ error: 'provider secret detail' })
    );
  });
});

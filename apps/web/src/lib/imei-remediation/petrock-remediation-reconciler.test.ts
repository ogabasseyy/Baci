import { describe, expect, it, vi } from 'vitest';
import { reconcilePetrockRemediationOrder } from './petrock-remediation-reconciler';

function order(overrides: Record<string, unknown> = {}) {
  return {
    carrier: null,
    customer_id: 'customer-1',
    device_model: null,
    eligibility_checks_completed: [],
    eligibility_evidence: {
      blacklistStatus: 'Unknown',
      carrier: 'Unknown',
      device: 'iPhone 17 Pro Max',
      simLock: 'Locked',
    },
    eligibility_next_check: 'carrier_detection' as const,
    id: 'order-1',
    identifier_ciphertext: 'ciphertext',
    merchant_id: 'merchant-1',
    payment_currency: null,
    provider_attempt_started_at: new Date().toISOString(),
    provider_order_id: 'provider-order-1',
    reconcile_attempts: 1,
    reconcile_lease_token: 'lease-1',
    remediation_product_id: null,
    refund_policy: null,
    status: 'eligibility_pending',
    ...overrides,
  };
}

function state() {
  return {
    advanceEvidence: vi.fn().mockResolvedValue(true),
    begin: vi.fn().mockResolvedValue(true),
    finalize: vi.fn().mockResolvedValue(true),
    failBeforeAcceptance: vi.fn().mockResolvedValue(true),
    markSubmissionUnknown: vi.fn().mockResolvedValue(true),
    resolveEligibility: vi.fn().mockResolvedValue(true),
    recordSubmission: vi.fn().mockResolvedValue(true),
    reschedule: vi.fn().mockResolvedValue(true),
    suppress: vi.fn().mockResolvedValue(true),
  };
}

describe('reconcilePetrockRemediationOrder', () => {
  it('merges a successful house check and immediately starts the next check', async () => {
    const reconcileState = state();
    const startNext = vi.fn().mockResolvedValue({
      check: 'carrier_status',
      kind: 'pending',
    });

    const result = await reconcilePetrockRemediationOrder({
      client: {
        getAccount: vi.fn(),
        getOrder: vi.fn().mockResolvedValue({
          data: {
            orderUuid: 'provider-order-1',
            replay: 'Model: iPhone 17 Pro Max<br>Locked Carrier: US AT&T',
            status: 'success',
          },
          ok: true,
          rawText: '{}',
        }),
        submitOrder: vi.fn(),
      },
      decryptIdentifier: () => '490154203237518',
      loadProducts: vi.fn().mockResolvedValue([]),
      order: order({
        eligibility_evidence: {
          blacklistStatus: 'Clean',
          simLock: 'Locked',
          carrier: 'Unknown',
          device: 'iPhone 17 Pro Max',
        },
      }),
      origin: 'https://ogabassey.com',
      readProduct: vi.fn(),
      startNext,
      state: reconcileState,
    });

    expect(result.kind).toBe('eligibility_advanced');
    expect(reconcileState.advanceEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        check: 'carrier_detection',
        evidence: expect.objectContaining({ carrier: 'US AT&T' }),
      })
    );
    expect(startNext).toHaveBeenCalledWith(
      expect.objectContaining({
        order: expect.objectContaining({
          eligibilityEvidence: expect.objectContaining({
            carrier: 'US AT&T',
            blacklistStatus: 'Clean',
            simLock: 'Locked',
          }),
        }),
      })
    );
  });

  it('atomically fails and refunds a rejected paid unlock', async () => {
    const reconcileState = state();
    await reconcilePetrockRemediationOrder({
      client: {
        getOrder: vi.fn().mockResolvedValue({
          data: {
            orderUuid: 'provider-order-1',
            replay: '',
            status: 'reject',
          },
          ok: true,
          rawText: '{}',
        }),
      },
      decryptIdentifier: () => '490154203237518',
      loadProducts: vi.fn().mockResolvedValue([]),
      order: order({
        eligibility_next_check: null,
        refund_policy: 'refundable',
        status: 'in_progress',
      }),
      origin: 'https://ogabassey.com',
      readProduct: vi.fn(),
      startNext: vi.fn(),
      state: reconcileState,
    });

    expect(reconcileState.finalize).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });

  it('reschedules a normal in-process provider order', async () => {
    const reconcileState = state();
    await reconcilePetrockRemediationOrder({
      client: {
        getOrder: vi.fn().mockResolvedValue({
          data: {
            orderUuid: 'provider-order-1',
            replay: '',
            status: 'in-process',
          },
          ok: true,
          rawText: '{}',
        }),
      },
      decryptIdentifier: () => '490154203237518',
      loadProducts: vi.fn().mockResolvedValue([]),
      order: order({ eligibility_next_check: null, status: 'in_progress' }),
      origin: 'https://ogabassey.com',
      readProduct: vi.fn(),
      startNext: vi.fn(),
      state: reconcileState,
    });

    expect(reconcileState.reschedule).toHaveBeenCalledWith(
      expect.objectContaining({ providerStatus: 'in-process' })
    );
  });

  it('recovers a stale paid row before classifying missing provider identity', async () => {
    const reconcileState = state();
    const recoverPaidOrder = vi.fn().mockResolvedValue({ kind: 'pending' });

    const result = await reconcilePetrockRemediationOrder({
      client: { getOrder: vi.fn() },
      decryptIdentifier: () => '490154203237518',
      loadProducts: vi.fn().mockResolvedValue([]),
      order: order({
        provider_order_id: null,
        status: 'paid',
      }),
      origin: 'https://ogabassey.com',
      readProduct: vi.fn(),
      recoverPaidOrder,
      startNext: vi.fn(),
      state: reconcileState,
    });

    expect(result.kind).toBe('pending');
    expect(recoverPaidOrder).toHaveBeenCalledOnce();
    expect(reconcileState.markSubmissionUnknown).not.toHaveBeenCalled();
  });

  it('does not refund an unresolved no-id remediation submission', async () => {
    const reconcileState = state();

    const result = await reconcilePetrockRemediationOrder({
      client: { getOrder: vi.fn() },
      decryptIdentifier: () => '490154203237518',
      loadProducts: vi.fn().mockResolvedValue([]),
      order: order({
        eligibility_next_check: null,
        payment_currency: 'NGN',
        provider_order_id: null,
        status: 'submission_unknown',
      }),
      origin: 'https://ogabassey.com',
      readProduct: vi.fn(),
      state: reconcileState,
    });

    expect(result.kind).toBe('submission_unknown');
    expect(reconcileState.failBeforeAcceptance).not.toHaveBeenCalled();
    expect(reconcileState.reschedule).toHaveBeenCalledWith(
      expect.objectContaining({
        providerStatus: 'provider_submission_unresolved',
      })
    );
  });

  it('flags an unresolved paid submission for review after repeated attempts', async () => {
    const reconcileState = state();
    const result = await reconcilePetrockRemediationOrder({
      client: { getOrder: vi.fn() },
      decryptIdentifier: () => '490154203237518',
      loadProducts: vi.fn().mockResolvedValue([]),
      order: order({
        eligibility_next_check: null,
        payment_currency: 'NGN',
        provider_order_id: null,
        status: 'submission_unknown',
        reconcile_attempts: 12,
      }),
      origin: 'https://ogabassey.com',
      readProduct: vi.fn(),
      state: reconcileState,
    });
    expect(result).toEqual({ kind: 'submission_unknown', needsReview: true });
    expect(reconcileState.failBeforeAcceptance).not.toHaveBeenCalled();
  });

  it('suppresses an unresolved no-id eligibility submission', async () => {
    const reconcileState = state();

    const result = await reconcilePetrockRemediationOrder({
      client: { getOrder: vi.fn() },
      decryptIdentifier: () => '490154203237518',
      loadProducts: vi.fn().mockResolvedValue([]),
      order: order({ provider_order_id: null, status: 'submission_unknown' }),
      origin: 'https://ogabassey.com',
      readProduct: vi.fn(),
      state: reconcileState,
    });

    expect(result.kind).toBe('suppressed');
    expect(reconcileState.suppress).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'eligibility_submission_unresolved' })
    );
  });

  it('keeps a persisted unknown eligibility check in the eligibility path', async () => {
    const reconcileState = state();
    const startNext = vi.fn().mockResolvedValue({ kind: 'ready' });

    const result = await reconcilePetrockRemediationOrder({
      client: {
        getAccount: vi.fn(),
        getOrder: vi.fn().mockResolvedValue({
          data: {
            orderUuid: 'provider-order-1',
            replay: 'Model: iPhone 17 Pro Max<br>Locked Carrier: US AT&T',
            status: 'success',
          },
          ok: true,
          rawText: '{}',
        }),
        submitOrder: vi.fn(),
      },
      decryptIdentifier: () => '490154203237518',
      loadProducts: vi.fn().mockResolvedValue([]),
      order: order({ status: 'submission_unknown' }),
      origin: 'https://ogabassey.com',
      readProduct: vi.fn(),
      startNext,
      state: reconcileState,
    });

    expect(result.kind).toBe('eligibility_advanced');
    expect(reconcileState.advanceEvidence).toHaveBeenCalled();
    expect(reconcileState.finalize).not.toHaveBeenCalled();
  });

  it('fails closed when a persisted remediation model scope is malformed', async () => {
    const reconcileState = state();
    const startNext = vi.fn().mockResolvedValue({ kind: 'ready' });

    const result = await reconcilePetrockRemediationOrder({
      client: {
        getAccount: vi.fn(),
        getOrder: vi.fn().mockResolvedValue({
          data: {
            orderUuid: 'provider-order-1',
            replay:
              'Model: iPhone 17 Pro Max<br>Locked Carrier: US AT&T<br>USA Blacklist: Clean<br>SIMLock: Locked<br>Finance: Clean',
            status: 'success',
          },
          ok: true,
          rawText: '{}',
        }),
        submitOrder: vi.fn(),
      },
      decryptIdentifier: () => '490154203237518',
      loadProducts: vi.fn().mockResolvedValue([
        {
          carrier: 'AT&T',
          id: 'product-1',
          manual_disabled: false,
          model_scope: { kind: 'range', max: '17', min: 16 },
          status_segment: 'clean',
        },
      ]),
      order: order({
        eligibility_evidence: {
          blacklistStatus: 'Clean',
          carrier: 'US AT&T',
          device: 'iPhone 17 Pro Max',
          financeStatus: 'Clean',
          simLock: 'Locked',
        },
      }),
      origin: 'https://ogabassey.com',
      readProduct: vi.fn(),
      startNext,
      state: reconcileState,
    });

    expect(result.kind).toBe('eligibility_advanced');
    expect(reconcileState.resolveEligibility).toHaveBeenCalledWith(
      expect.objectContaining({
        failureReason: 'no_matching_product',
        status: 'suppressed',
      })
    );
  });
});

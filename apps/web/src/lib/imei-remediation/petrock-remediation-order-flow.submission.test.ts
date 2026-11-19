import { describe, expect, it, vi } from 'vitest';
import { placePetrockRemediationOrder } from './petrock-remediation-order-flow';

function state() {
  return {
    begin: vi.fn().mockResolvedValue(true),
    failBeforeAcceptance: vi.fn().mockResolvedValue(true),
    finalize: vi.fn().mockResolvedValue(true),
    markSubmissionUnknown: vi.fn().mockResolvedValue(true),
    prepare: vi
      .fn()
      .mockResolvedValue({ id: 'order-1', status: 'payment_pending' }),
    recordSubmission: vi.fn().mockResolvedValue(true),
    redeem: vi.fn().mockResolvedValue(true),
    resetPreparedQuote: vi.fn().mockResolvedValue(true),
  };
}

const input = {
  fxRate: 1575,
  identifier: '490154203237518',
  order: {
    amountNgn: null,
    amountUsdt: null,
    costUsd: 75,
    customerId: 'customer-1',
    id: 'order-1',
    merchantId: 'merchant-1',
    eligibilityEvidence: {
      blacklistStatus: 'Clean',
      simLock: 'Locked',
      carrier: 'AT&T',
      device: 'iPhone 17 Pro Max',
      financeStatus: 'Clean',
    },
    providerOrderId: null,
    providerAttemptStartedAt: null,
    status: 'eligible' as const,
  },
  origin: 'https://ogabassey.com',
  paymentCurrency: 'NGN' as const,
  product: {
    active: true,
    catalogCostUsd: 75,
    catalogOrderFieldName: 'IMEI',
    catalogSyncedAt: new Date().toISOString(),
    carrier: 'AT&T',
    modelScope: { kind: 'generic' },
    statusSegment: 'clean',
    curatedProductId: '22222222-2222-4222-8222-222222222222',
    orderFieldName: 'IMEI',
    providerProductId: 'unlock-product',
    priceNgn: 150_000,
    priceUsdt: 100,
  },
};

describe('placePetrockRemediationOrder submission outcomes', () => {
  it('does not report a refund when a provider receipt wins the rejection race', async () => {
    const orderState = state();
    orderState.failBeforeAcceptance.mockResolvedValue(false);
    const result = await placePetrockRemediationOrder({
      ...input,
      client: {
        getAccount: vi.fn().mockResolvedValue({
          data: { balance: 100, currency: 'USD' },
          ok: true,
          rawText: '{}',
        }),
        submitOrder: vi.fn().mockResolvedValue({
          kind: 'http',
          message: 'rejected',
          ok: false,
          status: 400,
        }),
      },
      state: orderState,
    });
    expect(result.kind).toBe('already_started');
  });

  it('holds funds and marks an ambiguous POST timeout without refunding', async () => {
    const orderState = state();
    const result = await placePetrockRemediationOrder({
      ...input,
      client: {
        getAccount: vi.fn().mockResolvedValue({
          data: { balance: 100, currency: 'USD' },
          ok: true,
          rawText: '{}',
        }),
        submitOrder: vi.fn().mockResolvedValue({
          kind: 'timeout',
          message: 'timeout',
          ok: false,
        }),
      },
      state: orderState,
    });

    expect(result.kind).toBe('submission_unknown');
    expect(orderState.markSubmissionUnknown).toHaveBeenCalled();
    expect(orderState.finalize).not.toHaveBeenCalled();
  });

  it('retries persistence of an accepted provider order before escalating', async () => {
    const orderState = state();
    orderState.recordSubmission
      .mockRejectedValueOnce(new TypeError('temporary database error'))
      .mockResolvedValueOnce(true);

    const result = await placePetrockRemediationOrder({
      ...input,
      client: {
        getAccount: vi.fn().mockResolvedValue({
          data: { balance: 100, currency: 'USD' },
          ok: true,
          rawText: '{}',
        }),
        submitOrder: vi.fn().mockResolvedValue({
          data: { orderUuid: 'provider-order-1' },
          ok: true,
          rawText: '{}',
        }),
      },
      state: orderState,
    });

    expect(result.kind).toBe('pending');
    expect(orderState.recordSubmission).toHaveBeenCalledTimes(2);
  });

  it('marks an accepted order unknown when durable persistence is exhausted', async () => {
    const orderState = state();
    orderState.recordSubmission.mockRejectedValue(
      new TypeError('database unavailable')
    );

    const result = await placePetrockRemediationOrder({
      ...input,
      client: {
        getAccount: vi.fn().mockResolvedValue({
          data: { balance: 100, currency: 'USD' },
          ok: true,
          rawText: '{}',
        }),
        submitOrder: vi.fn().mockResolvedValue({
          data: { orderUuid: 'provider-order-1' },
          ok: true,
          rawText: '{}',
        }),
      },
      state: orderState,
    });

    expect(result.kind).toBe('submission_unknown');
    expect(orderState.recordSubmission).toHaveBeenCalledTimes(2);
    expect(orderState.markSubmissionUnknown).toHaveBeenCalledWith({
      orderId: 'order-1',
      providerOrderId: 'provider-order-1',
      reason: 'accepted_submission_persistence_failed',
    });
  });

  it('refunds an HTTP-rejected submission regardless of denial policy', async () => {
    const orderState = state();
    const result = await placePetrockRemediationOrder({
      ...input,
      client: {
        getAccount: vi.fn().mockResolvedValue({
          data: { balance: 100, currency: 'USD' },
          ok: true,
          rawText: '{}',
        }),
        submitOrder: vi.fn().mockResolvedValue({
          kind: 'http',
          message: 'rejected',
          ok: false,
          status: 400,
        }),
      },
      state: orderState,
    });

    expect(result.kind).toBe('failed');
    expect(orderState.failBeforeAcceptance).toHaveBeenCalledWith({
      customerMessage: 'The carrier could not accept this unlock order.',
      orderId: 'order-1',
      reason: 'provider_submit_rejected',
    });
    expect(orderState.finalize).not.toHaveBeenCalled();
  });

  it('holds funds when a POST receives an ambiguous server error', async () => {
    const orderState = state();
    const result = await placePetrockRemediationOrder({
      ...input,
      client: {
        getAccount: vi.fn().mockResolvedValue({
          data: { balance: 100, currency: 'USD' },
          ok: true,
          rawText: '{}',
        }),
        submitOrder: vi.fn().mockResolvedValue({
          kind: 'http',
          message: 'server error',
          ok: false,
          status: 500,
        }),
      },
      state: orderState,
    });

    expect(result.kind).toBe('submission_unknown');
    expect(orderState.markSubmissionUnknown).toHaveBeenCalled();
    expect(orderState.failBeforeAcceptance).not.toHaveBeenCalled();
  });
});

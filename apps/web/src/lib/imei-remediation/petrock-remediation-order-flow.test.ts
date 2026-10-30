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

describe('placePetrockRemediationOrder', () => {
  it.each([
    'catalog',
    'balance',
  ])('does not report a failed preflight refund when the guard loses a %s race', async (failure) => {
    const orderState = state();
    orderState.failBeforeAcceptance.mockResolvedValue(false);
    const result = await placePetrockRemediationOrder({
      ...input,
      order: { ...input.order, status: 'paid' },
      product: { ...input.product, active: failure !== 'catalog' },
      client: {
        getAccount: vi.fn().mockResolvedValue({
          ok: true,
          data: { balance: failure === 'balance' ? 0 : 100, currency: 'USD' },
        }),
        submitOrder: vi.fn(),
      },
      state: orderState,
    });
    expect(result.kind).toBe('already_started');
  });

  it('preflights, captures the wallet, write-aheads, and only then submits', async () => {
    const calls: string[] = [];
    const orderState = state();
    orderState.prepare.mockImplementation(() => {
      calls.push('prepare');
      return Promise.resolve({ id: 'order-1', status: 'payment_pending' });
    });
    orderState.redeem.mockImplementation(() => {
      calls.push('redeem');
      return Promise.resolve(true);
    });
    orderState.begin.mockImplementation(() => {
      calls.push('begin');
      return Promise.resolve(true);
    });
    const submitOrder = vi.fn(() => {
      calls.push('submit');
      return Promise.resolve({
        data: { orderUuid: 'provider-order-1' },
        ok: true as const,
        rawText: '{}',
      });
    });

    const result = await placePetrockRemediationOrder({
      ...input,
      client: {
        getAccount: vi.fn().mockResolvedValue({
          data: { balance: 100, currency: 'USD' },
          ok: true,
          rawText: '{}',
        }),
        submitOrder,
      },
      state: orderState,
    });

    expect(result.kind).toBe('pending');
    expect(calls).toEqual(['prepare', 'redeem', 'begin', 'submit']);
    expect(orderState.recordSubmission).toHaveBeenCalled();
  });

  it('does not capture when reseller balance cannot cover the product', async () => {
    const orderState = state();
    const result = await placePetrockRemediationOrder({
      ...input,
      client: {
        getAccount: vi.fn().mockResolvedValue({
          data: { balance: 20, currency: 'USD' },
          ok: true,
          rawText: '{}',
        }),
        submitOrder: vi.fn(),
      },
      state: orderState,
    });

    expect(result.kind).toBe('preflight_failed');
    expect(orderState.prepare).not.toHaveBeenCalled();
    expect(orderState.redeem).not.toHaveBeenCalled();
  });

  it('resumes a prepared quote without preparing it a second time', async () => {
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
          data: { orderUuid: 'provider-order-1' },
          ok: true,
          rawText: '{}',
        }),
      },
      order: {
        ...input.order,
        amountNgn: 150_000,
        status: 'payment_pending',
      },
      state: orderState,
    });

    expect(result.kind).toBe('pending');
    expect(orderState.prepare).not.toHaveBeenCalled();
    expect(orderState.redeem).toHaveBeenCalledOnce();
  });

  it('invalidates a stale payment-pending quote when preflight fails', async () => {
    const orderState = state();

    const result = await placePetrockRemediationOrder({
      ...input,
      client: { getAccount: vi.fn(), submitOrder: vi.fn() },
      order: {
        ...input.order,
        amountNgn: 150_000,
        status: 'payment_pending',
      },
      product: { ...input.product, active: false },
      state: orderState,
    });

    expect(result.kind).toBe('preflight_failed');
    expect(orderState.resetPreparedQuote).toHaveBeenCalledWith({
      orderId: 'order-1',
      reason: 'provider_preflight_failed',
    });
  });

  it('refunds a captured wallet when paid-order preflight fails', async () => {
    const orderState = state();

    const result = await placePetrockRemediationOrder({
      ...input,
      client: {
        getAccount: vi.fn().mockResolvedValue({
          data: { balance: 20, currency: 'USD' },
          ok: true,
          rawText: '{}',
        }),
        submitOrder: vi.fn(),
      },
      order: { ...input.order, status: 'paid' },
      state: orderState,
    });

    expect(result.kind).toBe('preflight_failed');
    expect(orderState.failBeforeAcceptance).toHaveBeenCalledWith({
      customerMessage:
        'This unlock could not be submitted, so your wallet was refunded.',
      orderId: 'order-1',
      reason: 'provider_preflight_failed',
    });
  });

  it('rejects a quote that no longer covers provider cost at the current FX rate', async () => {
    const orderState = state();

    const result = await placePetrockRemediationOrder({
      ...input,
      product: { ...input.product, priceNgn: 100_000 },
      state: orderState,
      client: {
        getAccount: vi.fn().mockResolvedValue({
          data: { balance: 100, currency: 'USD' },
          ok: true,
          rawText: '{}',
        }),
        submitOrder: vi.fn(),
      },
    });

    expect(result.kind).toBe('preflight_failed');
    expect(orderState.prepare).not.toHaveBeenCalled();
    expect(orderState.redeem).not.toHaveBeenCalled();
  });

  it('refunds a paid NGN quote that became loss-making before submission', async () => {
    const orderState = state();

    const result = await placePetrockRemediationOrder({
      ...input,
      order: {
        ...input.order,
        amountNgn: 100_000,
        status: 'paid',
      },
      state: orderState,
      client: {
        getAccount: vi.fn().mockResolvedValue({
          data: { balance: 100, currency: 'USD' },
          ok: true,
          rawText: '{}',
        }),
        submitOrder: vi.fn(),
      },
    });

    expect(result.kind).toBe('preflight_failed');
    expect(orderState.failBeforeAcceptance).toHaveBeenCalled();
    expect(orderState.begin).not.toHaveBeenCalled();
  });

  it('fails closed for a future-dated provider catalog snapshot', async () => {
    const orderState = state();
    const getAccount = vi.fn();

    const result = await placePetrockRemediationOrder({
      ...input,
      client: { getAccount, submitOrder: vi.fn() },
      product: {
        ...input.product,
        catalogSyncedAt: new Date(Date.now() + 60_000).toISOString(),
      },
      state: orderState,
    });

    expect(result.kind).toBe('preflight_failed');
    expect(orderState.prepare).not.toHaveBeenCalled();
    expect(getAccount).not.toHaveBeenCalled();
  });
});

it.each([
  'eligible',
  'payment_pending',
  'paid',
] as const)('revalidates stored negative evidence for a %s order before any debit or submission', async (status) => {
  const orderState = state();
  const client = { getAccount: vi.fn(), submitOrder: vi.fn() };
  const result = await placePetrockRemediationOrder({
    ...input,
    client,
    state: orderState,
    order: {
      ...input.order,
      status,
      eligibilityEvidence: {
        blacklistStatus: 'Clean',
        simLock: 'Locked',
        carrier: 'AT&T',
        device: 'iPhone 17 Pro Max',
        financeStatus: 'Not Eligible',
      },
    },
    product: {
      ...input.product,
      carrier: 'AT&T',
      modelScope: { kind: 'generic' },
      statusSegment: 'clean',
    },
  });
  expect(result.kind).toBe(status === 'paid' ? 'failed' : 'eligibility_failed');
  expect(client.getAccount).not.toHaveBeenCalled();
  expect(client.submitOrder).not.toHaveBeenCalled();
  expect(orderState.redeem).not.toHaveBeenCalled();
  expect(orderState.begin).not.toHaveBeenCalled();
  if (status === 'payment_pending')
    expect(orderState.resetPreparedQuote).toHaveBeenCalledWith({
      orderId: 'order-1',
      reason: 'eligibility_evidence_invalid',
    });
  expect(orderState.failBeforeAcceptance).toHaveBeenCalledTimes(
    status === 'paid' ? 1 : 0
  );
});

it.each([
  { providerOrderId: 'accepted-1', providerAttemptStartedAt: null },
  { providerOrderId: null, providerAttemptStartedAt: '2026-10-25T18:00:00Z' },
])('does not refund or resubmit an already-started order: %j', async (markers) => {
  const orderState = state();
  const client = { getAccount: vi.fn(), submitOrder: vi.fn() };
  const result = await placePetrockRemediationOrder({
    ...input,
    client,
    state: orderState,
    order: {
      ...input.order,
      status: 'paid',
      eligibilityEvidence: {},
      ...markers,
    },
  });
  expect(result.kind).toBe('already_started');
  expect(orderState.failBeforeAcceptance).not.toHaveBeenCalled();
  expect(client.submitOrder).not.toHaveBeenCalled();
  expect(orderState.redeem).not.toHaveBeenCalled();
});
it('does not claim a refund when the atomic eligibility rejection loses a race', async () => {
  const orderState = state();
  orderState.failBeforeAcceptance.mockResolvedValue(false);
  const client = { getAccount: vi.fn(), submitOrder: vi.fn() };
  const result = await placePetrockRemediationOrder({
    ...input,
    client,
    state: orderState,
    order: { ...input.order, status: 'paid', eligibilityEvidence: {} },
  });
  expect(result.kind).toBe('already_started');
  expect(client.submitOrder).not.toHaveBeenCalled();
});

it('keeps the concurrent order state when the invalid quote reset loses a race', async () => {
  const orderState = state();
  orderState.resetPreparedQuote.mockResolvedValue(false);
  const result = await placePetrockRemediationOrder({
    ...input,
    order: {
      ...input.order,
      status: 'payment_pending',
      eligibilityEvidence: {
        ...input.order.eligibilityEvidence,
        financeStatus: 'Not Eligible',
      },
    },
    client: { getAccount: vi.fn(), submitOrder: vi.fn() },
    state: orderState,
  });
  expect(result.kind).toBe('already_started');
  expect(orderState.redeem).not.toHaveBeenCalled();
});

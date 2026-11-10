import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  execute: vi.fn(),
  run: vi.fn(),
}));

vi.mock('@/lib/orders/execute-order-cancellation-side-effect', () => ({
  executeOrderCancellationSideEffect: mocks.execute,
}));
vi.mock('@/lib/orders/run-order-cancellation-side-effect', () => ({
  runOrderCancellationSideEffect: mocks.run,
}));
vi.mock('@/lib/orders/alert-merchant-cancellation-refund-review', () => ({
  alertMerchantOfCancellationRefundReview: mocks.alert,
}));

import { drainFailedOrderCancellationSideEffects } from './drain-failed-order-cancellation-side-effects';

function query(data: unknown) {
  return {
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data, error: null }),
    lt: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error: null }),
  };
}

async function drainRefundStep() {
  const candidate = {
    claimed_at: '2026-11-05T00:00:00Z',
    order_id: 'order-1',
    step: 'refund',
  };
  const from = vi
    .fn()
    .mockReturnValueOnce(query([candidate]))
    .mockReturnValueOnce(query([]))
    .mockReturnValueOnce(query([]))
    .mockReturnValueOnce(
      query({
        currency: 'NGN',
        id: 'order-1',
        merchant_id: 'merchant-1',
        order_number: '1042',
      })
    )
    .mockReturnValueOnce(
      query({ email: 'owner@example.com', id: 'merchant-1' })
    );
  return drainFailedOrderCancellationSideEffects({
    sendCancellationEmail: vi.fn(),
    supabase: { from } as never,
  });
}

describe('drain refund-failure merchant alert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.alert.mockResolvedValue(undefined);
  });

  it.each([
    'failed',
    'delivery_uncertain',
  ])('alerts the merchant when the refund step ends %s', async (status) => {
    mocks.run.mockResolvedValue(status);
    const summary = await drainRefundStep();
    expect(mocks.alert).toHaveBeenCalledTimes(1);
    expect(mocks.alert.mock.calls[0][0]).toMatchObject({
      merchant: { email: 'owner@example.com', id: 'merchant-1' },
      order: { id: 'order-1', order_number: '1042' },
    });
    expect(summary.failed).toHaveLength(1);
  });

  it.each([
    'completed',
    'deferred',
  ])('does not alert when the refund step ends %s', async (status) => {
    mocks.run.mockResolvedValue(status);
    await drainRefundStep();
    expect(mocks.alert).not.toHaveBeenCalled();
  });
});

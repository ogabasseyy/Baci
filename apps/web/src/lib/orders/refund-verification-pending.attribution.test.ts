import { describe, expect, it, vi } from 'vitest';
import { isRefundVerificationPending } from './refund-verification-pending';

function chain(result: { data: unknown; error: Error | null }) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of [
    'select',
    'eq',
    'lt',
    'in',
    'gt',
    'ilike',
    'order',
    'abortSignal',
  ]) {
    query[method] = vi.fn().mockReturnValue(query);
  }
  query.limit = vi.fn().mockResolvedValue(result);
  return query;
}

const leg = {
  amount: 100,
  currency: 'NGN',
  gateway: 'paystack',
  id: 'leg-1',
  order_id: 'order-1',
};

function refund(overrides: Record<string, unknown> = {}) {
  return {
    amount: 100,
    currency: 'NGN',
    metadata: { payment_transaction_id: 'leg-1' },
    order_id: 'order-1',
    ...overrides,
  };
}

function stepsWith(orderIds: string[]) {
  return {
    data: orderIds.map((order_id) => ({ order_id })),
    error: null,
  };
}

describe('isRefundVerificationPending unlinked attribution', () => {
  it('attributes an unlinked legacy refund to the sole Paystack leg', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(chain(stepsWith(['order-1'])))
      .mockReturnValueOnce(chain({ data: [], error: null }))
      .mockReturnValueOnce(chain({ data: [leg], error: null }))
      .mockReturnValueOnce(
        chain({ data: [refund({ metadata: {} })], error: null })
      );
    const supabase = { from } as never;

    await expect(isRefundVerificationPending(supabase)).resolves.toBe(false);
  });

  it('ignores unlinked refunds from another candidate order', async () => {
    // Candidate B contributes an unlinked terminal refund while the
    // batch holds only candidate A's leg: it must not cover A's leg.
    const from = vi
      .fn()
      .mockReturnValueOnce(
        chain({ data: [{ order_id: 'order-1' }], error: null })
      )
      .mockReturnValueOnce(
        chain({ data: [{ order_id: 'order-2' }], error: null })
      )
      .mockReturnValueOnce(chain({ data: [leg], error: null }))
      .mockReturnValueOnce(
        chain({
          data: [refund({ metadata: {}, order_id: 'order-2' })],
          error: null,
        })
      );
    const supabase = { from } as never;

    await expect(isRefundVerificationPending(supabase)).resolves.toBe(true);
  });

  it('ignores linked refunds from another candidate order', async () => {
    // A malformed refund from candidate B names candidate A's leg
    // id: without order scoping it would cover A's leg and hide
    // the pending verification from the probe.
    const from = vi
      .fn()
      .mockReturnValueOnce(
        chain({ data: [{ order_id: 'order-1' }], error: null })
      )
      .mockReturnValueOnce(
        chain({ data: [{ order_id: 'order-2' }], error: null })
      )
      .mockReturnValueOnce(chain({ data: [leg], error: null }))
      .mockReturnValueOnce(
        chain({ data: [refund({ order_id: 'order-2' })], error: null })
      );
    const supabase = { from } as never;

    await expect(isRefundVerificationPending(supabase)).resolves.toBe(true);
  });

  it('ignores unlinked refunds when several Paystack legs exist', async () => {
    const leg2 = { ...leg, id: 'leg-2' };
    const from = vi
      .fn()
      .mockReturnValueOnce(chain(stepsWith(['order-1'])))
      .mockReturnValueOnce(chain({ data: [], error: null }))
      .mockReturnValueOnce(chain({ data: [leg, leg2], error: null }))
      .mockReturnValueOnce(
        chain({ data: [refund({ metadata: {} })], error: null })
      );
    const supabase = { from } as never;

    await expect(isRefundVerificationPending(supabase)).resolves.toBe(true);
  });
});

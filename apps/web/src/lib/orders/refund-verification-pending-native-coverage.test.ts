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

describe('isRefundVerificationPending native Paystack rows', () => {
  it('returns true when the linked refund is an unverified native Paystack row', async () => {
    // Native worker rows carry Paystack identity in the gateway
    // column with no method metadata: without a processed verdict
    // the row proves nothing and must not count as coverage.
    const from = vi
      .fn()
      .mockReturnValueOnce(chain(stepsWith(['order-1'])))
      .mockReturnValueOnce(chain({ data: [], error: null }))
      .mockReturnValueOnce(chain({ data: [leg], error: null }))
      .mockReturnValueOnce(
        chain({ data: [refund({ gateway: 'paystack' })], error: null })
      );
    const supabase = { from } as never;

    await expect(isRefundVerificationPending(supabase)).resolves.toBe(true);
  });

  it('returns false when the native Paystack row is provider-verified', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(chain(stepsWith(['order-1'])))
      .mockReturnValueOnce(chain({ data: [], error: null }))
      .mockReturnValueOnce(chain({ data: [leg], error: null }))
      .mockReturnValueOnce(
        chain({
          data: [
            refund({
              gateway: ' Paystack ',
              metadata: {
                payment_transaction_id: 'leg-1',
                provider_refund_status: 'processed',
              },
            }),
          ],
          error: null,
        })
      );
    const supabase = { from } as never;

    await expect(isRefundVerificationPending(supabase)).resolves.toBe(false);
  });
});

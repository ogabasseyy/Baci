import { describe, expect, it, vi } from 'vitest';
import { isRefundVerificationPending } from './refund-verification-pending';

function chain(result: { data: unknown; error: Error | null }) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ['select', 'eq', 'lt', 'in', 'gt', 'ilike', 'order']) {
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
};

function refund(legId: string) {
  return {
    amount: 100,
    currency: 'NGN',
    metadata: { payment_transaction_id: legId },
  };
}

describe('isRefundVerificationPending leg pagination', () => {
  it('finds an uncovered leg past a full page of covered legs', async () => {
    const page1 = Array.from({ length: 25 }, (_, index) => ({
      ...leg,
      id: `page1-${index}`,
    }));
    const from = vi
      .fn()
      .mockReturnValueOnce(
        chain({ data: [{ order_id: 'order-1' }], error: null })
      )
      .mockReturnValueOnce(chain({ data: [], error: null }))
      .mockReturnValueOnce(chain({ data: page1, error: null }))
      .mockReturnValueOnce(chain({ data: [leg], error: null }))
      .mockReturnValueOnce(
        chain({
          data: page1.map((row) => refund(row.id)),
          error: null,
        })
      );
    const supabase = { from } as never;

    await expect(isRefundVerificationPending(supabase)).resolves.toBe(true);
    // The second page resumes after the last id of the first in id
    // order: every candidate leg is scanned, so covered rows can
    // never crowd the uncovered leg out of the probe.
    const page2Query = from.mock.results[3]?.value as Record<
      string,
      ReturnType<typeof vi.fn>
    >;
    expect(page2Query.gt).toHaveBeenCalledWith('id', 'page1-24');
  });

  it('returns false when every leg across pages is covered', async () => {
    const page1 = Array.from({ length: 25 }, (_, index) => ({
      ...leg,
      id: `page1-${index}`,
    }));
    const from = vi
      .fn()
      .mockReturnValueOnce(
        chain({ data: [{ order_id: 'order-1' }], error: null })
      )
      .mockReturnValueOnce(chain({ data: [], error: null }))
      .mockReturnValueOnce(chain({ data: page1, error: null }))
      .mockReturnValueOnce(chain({ data: [leg], error: null }))
      .mockReturnValueOnce(
        chain({
          data: [...page1.map((row) => refund(row.id)), refund('leg-1')],
          error: null,
        })
      );
    const supabase = { from } as never;

    await expect(isRefundVerificationPending(supabase)).resolves.toBe(false);
  });
});

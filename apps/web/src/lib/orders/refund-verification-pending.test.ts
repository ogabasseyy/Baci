import { describe, expect, it, vi } from 'vitest';
import { isRefundVerificationPending } from './refund-verification-pending';

function chain(result: { data: unknown; error: Error | null }) {
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'gt', 'ilike']) {
    query[method] = vi.fn().mockReturnValue(query);
  }
  query.limit = vi.fn().mockResolvedValue(result);
  return query;
}

describe('isRefundVerificationPending', () => {
  it('returns false without a leg read when no refund step needs work', async () => {
    const from = vi.fn().mockReturnValueOnce(chain({ data: [], error: null }));
    const supabase = { from } as never;

    await expect(isRefundVerificationPending(supabase)).resolves.toBe(false);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('returns true when a failed refund step has a funded Paystack leg', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(
        chain({ data: [{ order_id: 'order-1' }], error: null })
      )
      .mockReturnValueOnce(
        chain({ data: [{ gateway: 'paystack' }], error: null })
      );
    const supabase = { from } as never;

    await expect(isRefundVerificationPending(supabase)).resolves.toBe(true);
  });

  it('returns false when no leg normalizes to Paystack', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(
        chain({ data: [{ order_id: 'order-1' }], error: null })
      )
      .mockReturnValueOnce(
        chain({ data: [{ gateway: 'flutterwave' }], error: null })
      );
    const supabase = { from } as never;

    await expect(isRefundVerificationPending(supabase)).resolves.toBe(false);
  });

  it('fails closed on a step-read error so a probe outage never shortens reconciliation', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(chain({ data: null, error: new Error('boom') }));
    const supabase = { from } as never;

    await expect(isRefundVerificationPending(supabase)).resolves.toBe(false);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('fails closed on a leg-read error', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(
        chain({ data: [{ order_id: 'order-1' }], error: null })
      )
      .mockReturnValueOnce(chain({ data: null, error: new Error('boom') }));
    const supabase = { from } as never;

    await expect(isRefundVerificationPending(supabase)).resolves.toBe(false);
  });
});

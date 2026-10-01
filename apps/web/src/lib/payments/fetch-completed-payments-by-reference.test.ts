import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { fetchCompletedPaymentsByReference } from './fetch-completed-payments-by-reference';

function paymentChain(limit: ReturnType<typeof vi.fn>) {
  const chain: {
    eq: ReturnType<typeof vi.fn>;
    gt: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
  } = {
    eq: vi.fn(),
    gt: vi.fn(),
    limit,
    order: vi.fn(),
  };
  chain.eq.mockReturnValue(chain);
  chain.gt.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  return chain;
}

function database(pages: unknown[][]) {
  const limit = vi.fn();
  for (const page of pages) {
    limit.mockResolvedValueOnce({ data: page, error: null });
  }
  const chain = paymentChain(limit);
  const select = vi.fn().mockReturnValue(chain);
  const from = vi.fn().mockReturnValue({ select });
  return {
    chain,
    from,
    select,
    supabase: { from } as unknown as SupabaseClient,
  };
}

const payment = {
  amount: 100,
  gateway_reference: 'PSK-1',
  id: 'pay-1',
  merchant_id: 'merchant-1',
  order_id: 'order-1',
};

describe('fetchCompletedPaymentsByReference', () => {
  it('returns completed payments for the reference with exact filters', async () => {
    const { chain, from, select, supabase } = database([[payment], [payment]]);

    const result = await fetchCompletedPaymentsByReference(supabase, 'PSK-1');

    expect(result).toEqual([payment]);
    expect(from).toHaveBeenCalledWith('transactions');
    expect(select).toHaveBeenCalledWith(
      'id, order_id, merchant_id, gateway_reference, amount'
    );
    expect(chain.eq).toHaveBeenCalledWith('gateway', 'paystack');
    expect(chain.eq).toHaveBeenCalledWith('gateway_reference', 'PSK-1');
    expect(chain.eq).toHaveBeenCalledWith('transaction_type', 'payment');
    expect(chain.eq).toHaveBeenCalledWith('status', 'completed');
    expect(chain.order).toHaveBeenCalledWith('id', { ascending: true });
    expect(chain.limit).toHaveBeenCalledWith(10);
    expect(chain.gt).not.toHaveBeenCalled();
  });

  it('pages by id cursor so concurrent completions shift nothing', async () => {
    const first = Array.from({ length: 10 }, (_, index) => ({
      ...payment,
      id: `pay-${index}`,
    }));
    const second = [{ ...payment, id: 'pay-10' }];
    const { chain, supabase } = database([first, second, first, second]);

    const result = await fetchCompletedPaymentsByReference(supabase, 'PSK-1');

    expect(result).toHaveLength(11);
    // Offsets over this status-filtered set would shift when a
    // lower-id payment completes between page reads, omitting a later
    // match; the immutable id cursor cannot shift, and the stabilizing
    // pass re-reads the full set before acknowledging.
    expect(chain.gt).toHaveBeenCalledWith('id', 'pay-9');
    expect(chain.limit).toHaveBeenCalledTimes(4);
  });

  it('repeats the scan until a payment completing behind the cursor is found', async () => {
    const first = Array.from({ length: 10 }, (_, index) => ({
      ...payment,
      id: `pay-${index}`,
    }));
    // A lower-id payment completes after the first page is read: its
    // id sits behind the cursor, so the second page skips it and only
    // the stabilizing pass observes it.
    const late = { ...payment, id: 'pay-0-late' };
    const stabilizedFirst = [first[0], late, ...first.slice(1, 9)];
    const stabilizedSecond = [first[9]];
    const { supabase } = database([
      first,
      [],
      stabilizedFirst,
      stabilizedSecond,
      stabilizedFirst,
      stabilizedSecond,
    ]);

    const result = await fetchCompletedPaymentsByReference(supabase, 'PSK-1');

    expect(result.map((row) => row.id)).toEqual(
      [...first.map((row) => row.id), late.id].sort()
    );
  });

  it('returns an empty list when nothing matches', async () => {
    const { supabase } = database([[]]);

    const result = await fetchCompletedPaymentsByReference(supabase, 'PSK-1');

    expect(result).toEqual([]);
  });

  it('throws when the payment lookup fails', async () => {
    const limit = vi.fn().mockResolvedValue({
      data: null,
      error: new Error('db down'),
    });
    const select = vi.fn().mockReturnValue(paymentChain(limit));
    const from = vi.fn().mockReturnValue({ select });
    const supabase = { from } as unknown as SupabaseClient;

    await expect(
      fetchCompletedPaymentsByReference(supabase, 'PSK-1')
    ).rejects.toThrow('refund_event_payment_lookup_failed');
  });
});

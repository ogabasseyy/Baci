import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { fetchCompletedPaymentsByReference } from './fetch-completed-payments-by-reference';

function paymentChain(range: ReturnType<typeof vi.fn>) {
  const chain: {
    eq: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    range: ReturnType<typeof vi.fn>;
  } = {
    eq: vi.fn(),
    order: vi.fn(),
    range,
  };
  chain.eq.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  return chain;
}

function database(pages: unknown[][]) {
  const range = vi.fn();
  for (const page of pages) {
    range.mockResolvedValueOnce({ data: page, error: null });
  }
  const chain = paymentChain(range);
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
    const { chain, from, select, supabase } = database([[payment]]);

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
    expect(chain.range).toHaveBeenCalledWith(0, 9);
  });

  it('paginates full pages so no match is dropped', async () => {
    const first = Array.from({ length: 10 }, (_, index) => ({
      ...payment,
      id: `pay-${index}`,
    }));
    const second = [{ ...payment, id: 'pay-10' }];
    const { chain, supabase } = database([first, second]);

    const result = await fetchCompletedPaymentsByReference(supabase, 'PSK-1');

    expect(result).toHaveLength(11);
    expect(chain.range).toHaveBeenCalledWith(0, 9);
    expect(chain.range).toHaveBeenCalledWith(10, 19);
  });

  it('returns an empty list when nothing matches', async () => {
    const { supabase } = database([[]]);

    const result = await fetchCompletedPaymentsByReference(supabase, 'PSK-1');

    expect(result).toEqual([]);
  });

  it('throws when the payment lookup fails', async () => {
    const range = vi.fn().mockResolvedValue({
      data: null,
      error: new Error('db down'),
    });
    const select = vi.fn().mockReturnValue(paymentChain(range));
    const from = vi.fn().mockReturnValue({ select });
    const supabase = { from } as unknown as SupabaseClient;

    await expect(
      fetchCompletedPaymentsByReference(supabase, 'PSK-1')
    ).rejects.toThrow('refund_event_payment_lookup_failed');
  });
});

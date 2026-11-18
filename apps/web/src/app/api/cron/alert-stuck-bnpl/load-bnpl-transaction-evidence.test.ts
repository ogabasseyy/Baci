import { describe, expect, it, vi } from 'vitest';
import { getStuckBnplSignals } from './get-stuck-bnpl-signals';
import { loadBnplTransactionEvidence } from './load-bnpl-transaction-evidence';

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));

function orderSignals(payment_status = 'unpaid') {
  return getStuckBnplSignals({
    payment_method: 'credit_direct',
    payment_status,
    notes: '{"creditDirectTransactionId":"active-txn"}',
  });
}

function transactionLookup(
  data: unknown[],
  error = null as null | { message: string }
) {
  const inFilter = vi.fn().mockResolvedValue({ data, error });
  const from = vi.fn(() => ({ select: () => ({ in: inFilter }) }));
  return {
    supabase: { from } as unknown as Parameters<
      typeof loadBnplTransactionEvidence
    >[0],
    from,
    inFilter,
  };
}

describe('loadBnplTransactionEvidence', () => {
  it('skips already confirmed orders and accepts only matching progressed attempts', async () => {
    const order = { order_id: 'order-a', status: 'processing' };
    const { supabase, inFilter } = transactionLookup([
      { ...order, gateway: 'paystack', gateway_reference: 'active-txn' },
      { ...order, gateway: 'credit_direct', gateway_reference: 'old-txn' },
      { ...order, gateway: 'credit_direct', gateway_reference: 'active-txn' },
    ]);
    const result = await loadBnplTransactionEvidence(
      supabase,
      new Map([
        ['order-a', orderSignals()],
        ['confirmed', orderSignals('bnpl_approved')],
      ])
    );

    expect(inFilter).toHaveBeenCalledWith('order_id', ['order-a']);
    expect(result).toEqual({
      progressedOrderIds: new Set(['order-a']),
      referencesByOrderId: new Map([['order-a', 'active-txn']]),
      lookupFailed: false,
    });
  });

  it('reports a lookup failure without fabricating transaction evidence', async () => {
    const { supabase } = transactionLookup([], { message: 'unavailable' });
    expect(
      await loadBnplTransactionEvidence(
        supabase,
        new Map([['order-a', orderSignals()]])
      )
    ).toEqual({
      progressedOrderIds: new Set(),
      referencesByOrderId: new Map(),
      lookupFailed: true,
    });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { getStuckBnplSignals } from './get-stuck-bnpl-signals';
import { loadBnplTransactionEvidence } from './load-bnpl-transaction-evidence';
import { createTransactionQueryMock } from './transaction-query.test-support';

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));

function orderSignals(payment_status = 'unpaid') {
  return getStuckBnplSignals({
    payment_method: 'credit_direct',
    payment_status,
    notes: '{"creditDirectTransactionId":"active-txn"}',
  });
}

function transactionLookup(
  data: Record<string, unknown>[],
  error = null as null | { message: string },
  serverPageSize = 1000
) {
  const inFilter = vi.fn().mockResolvedValue({ data, error });
  const cursorFilter = vi.fn();
  const from = vi.fn(() =>
    createTransactionQueryMock(inFilter, serverPageSize, cursorFilter)
  );
  return {
    supabase: { from } as unknown as Parameters<
      typeof loadBnplTransactionEvidence
    >[0],
    from,
    inFilter,
    cursorFilter,
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

  it('reports progress without selecting an arbitrary reference when legacy attempts disagree', async () => {
    const row = {
      order_id: 'order-a',
      status: 'processing',
      gateway: 'credit_direct',
    };
    const { supabase } = transactionLookup([
      { ...row, gateway_reference: 'reference-a' },
      { ...row, gateway_reference: 'reference-b' },
    ]);
    const signals = getStuckBnplSignals({
      payment_method: 'credit_direct',
      payment_status: 'unpaid',
      notes: null,
    });

    const result = await loadBnplTransactionEvidence(
      supabase,
      new Map([['order-a', signals]])
    );
    expect(result.progressedOrderIds.has('order-a')).toBe(true);
    expect(result.referencesByOrderId.has('order-a')).toBe(false);
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

  it('bounds lookup batches and preserves evidence from every batch', async () => {
    const signals = new Map(
      Array.from({ length: 101 }, (_, index) => [
        `order-${index}`,
        orderSignals(),
      ])
    );
    const { supabase, inFilter } = transactionLookup([]);
    inFilter.mockImplementation(async (_column: string, ids: string[]) => ({
      data: ids.map((id) => ({
        id,
        order_id: id,
        status: 'processing',
        gateway: 'credit_direct',
        gateway_reference: 'active-txn',
      })),
      error: null,
    }));
    const result = await loadBnplTransactionEvidence(supabase, signals);
    expect(inFilter.mock.calls.map((call) => call[1].length)).toEqual([
      50, 50, 50, 50, 1, 1,
    ]);
    expect(result.progressedOrderIds.size).toBe(101);
    expect(result.referencesByOrderId.size).toBe(101);
    expect(result.lookupFailed).toBe(false);
  });

  it('preserves evidence from successful batches when another batch fails', async () => {
    const signals = new Map(
      Array.from({ length: 51 }, (_, index) => [
        `order-${index}`,
        orderSignals(),
      ])
    );
    const { supabase, inFilter } = transactionLookup([]);
    inFilter
      .mockResolvedValueOnce({
        data: [
          {
            order_id: 'order-0',
            status: 'processing',
            gateway: 'credit_direct',
            gateway_reference: 'active-txn',
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'unavailable' } });
    expect(await loadBnplTransactionEvidence(supabase, signals)).toEqual({
      progressedOrderIds: new Set(['order-0']),
      referencesByOrderId: new Map([['order-0', 'active-txn']]),
      lookupFailed: true,
    });
  });

  it.each([
    'klump',
    'credpal',
  ])('requires a nonempty provider reference for %s progress', async (provider) => {
    const signals = getStuckBnplSignals({
      payment_method: provider,
      payment_status: 'unpaid',
      notes: null,
    });
    const { supabase } = transactionLookup([
      {
        order_id: 'missing',
        status: 'processing',
        gateway: provider,
        gateway_reference: null,
      },
      {
        order_id: 'blank',
        status: 'completed',
        gateway: provider,
        gateway_reference: '  ',
      },
      {
        order_id: 'valid',
        status: 'processing',
        gateway: provider,
        gateway_reference: ' provider-ref ',
      },
    ]);
    expect(
      await loadBnplTransactionEvidence(
        supabase,
        new Map(['missing', 'blank', 'valid'].map((id) => [id, signals]))
      )
    ).toEqual({
      progressedOrderIds: new Set(['valid']),
      referencesByOrderId: new Map([['valid', 'provider-ref']]),
      lookupFailed: false,
    });
  });

  it('reads past a server row cap and preserves cross-page reference ambiguity', async () => {
    const legacySignals = getStuckBnplSignals({
      payment_method: 'credit_direct',
      payment_status: 'unpaid',
      notes: null,
    });
    const { supabase, cursorFilter } = transactionLookup(
      [
        {
          id: 'row-3',
          order_id: 'order-a',
          status: 'completed',
          gateway: 'credit_direct',
          gateway_reference: 'conflicting-reference',
        },
        {
          id: 'row-1',
          order_id: 'order-a',
          status: 'processing',
          gateway: 'credit_direct',
          gateway_reference: 'reference-a',
        },
        {
          id: 'row-2',
          order_id: 'order-b',
          status: 'completed',
          gateway: 'credit_direct',
          gateway_reference: 'reference-b',
        },
      ],
      null,
      2
    );
    const result = await loadBnplTransactionEvidence(
      supabase,
      new Map([
        ['order-a', legacySignals],
        ['order-b', legacySignals],
      ])
    );
    expect(result).toEqual({
      progressedOrderIds: new Set(['order-a', 'order-b']),
      referencesByOrderId: new Map([['order-b', 'reference-b']]),
      lookupFailed: false,
    });
    expect(cursorFilter).toHaveBeenCalledWith('id', 'row-2');
    expect(cursorFilter).toHaveBeenCalledWith('id', 'row-3');
  });

  it('discards an incomplete batch but retains another complete batch after a later page error', async () => {
    const signals = new Map(
      Array.from({ length: 51 }, (_, index) => [
        `order-${index}`,
        orderSignals(),
      ])
    );
    const { supabase, inFilter } = transactionLookup([]);
    inFilter
      .mockResolvedValueOnce({
        data: [
          {
            id: 'row-1',
            order_id: 'order-0',
            status: 'processing',
            gateway: 'credit_direct',
            gateway_reference: 'active-txn',
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'page unavailable' },
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: 'row-2',
            order_id: 'order-50',
            status: 'processing',
            gateway: 'credit_direct',
            gateway_reference: 'active-txn',
          },
        ],
        error: null,
      });
    expect(await loadBnplTransactionEvidence(supabase, signals)).toEqual({
      progressedOrderIds: new Set(['order-50']),
      referencesByOrderId: new Map([['order-50', 'active-txn']]),
      lookupFailed: true,
    });
  });
});

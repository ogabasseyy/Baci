import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileAbandonedPaystackAttempts } from './reconcile-abandoned-paystack-attempts';

const candidate = {
  amount: 100,
  currency: 'NGN',
  id: 'attempt-1',
  order_id: 'order-1',
  merchant_id: 'merchant-1',
  gateway_reference: 'BAC-OLD',
  metadata: {},
  status: 'pending',
};

function createClient(
  rows = [candidate],
  { paid = true, completed = true, dvaSibling = false } = {}
) {
  const selectUpdated = vi.fn().mockResolvedValue({
    data: [{ id: 'attempt-1' }],
    error: null,
  });
  const updateBuilder = {
    eq: vi.fn().mockReturnThis(),
    select: selectUpdated,
  };
  const update = vi.fn(() => updateBuilder);
  const lookup = {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
  };
  const orderLookup = {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: paid ? { id: 'order-1' } : null,
      error: null,
    }),
  };
  const completedLookup = {
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({
      data: completed
        ? [
            { id: 'paid-attempt', metadata: {} },
            ...(dvaSibling
              ? [
                  {
                    id: 'dva-paid-attempt',
                    metadata: { dva_lookup_path: 'order_payment_accounts' },
                  },
                ]
              : []),
          ]
        : [],
      error: null,
    }),
  };
  let transactionSelects = 0;
  const from = vi.fn((table: string) => ({
    select: vi.fn(() =>
      table === 'orders'
        ? orderLookup
        : transactionSelects++ % 2 === 0
          ? lookup
          : completedLookup
    ),
    update,
  }));
  return {
    client: { from },
    lookup,
    orderLookup,
    completedLookup,
    update,
    updateBuilder,
    selectUpdated,
  };
}

describe('reconcileAbandonedPaystackAttempts', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    'abandoned',
    'failed',
  ])('retires a provider-confirmed %s attempt linked to one order', async (status) => {
    const {
      client,
      lookup,
      orderLookup,
      completedLookup,
      update,
      updateBuilder,
    } = createClient();
    const verify = vi.fn().mockResolvedValue({
      success: true,
      data: { reference: 'BAC-OLD', status, amount: 10000, currency: 'NGN' },
    });

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify,
    });

    expect(summary.retired).toEqual(['attempt-1']);
    expect(lookup.eq).toHaveBeenCalledWith('gateway', 'paystack');
    expect(lookup.in).toHaveBeenCalledWith('status', ['pending', 'processing']);
    expect(lookup.in).toHaveBeenCalledWith('paid_order.payment_status', [
      'paid',
      'partially_paid',
    ]);
    expect(lookup.lt).toHaveBeenCalledWith('updated_at', expect.any(String));
    expect(orderLookup.in).toHaveBeenCalledWith('payment_status', [
      'paid',
      'partially_paid',
    ]);
    expect(completedLookup.eq).toHaveBeenCalledWith('status', 'completed');
    expect(completedLookup.neq).toHaveBeenCalledWith('id', 'attempt-1');
    expect(lookup.order).toHaveBeenCalledWith('updated_at', {
      ascending: true,
    });
    expect(verify).toHaveBeenCalledWith('BAC-OLD', expect.any(AbortSignal));
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
    expect(updateBuilder.eq).toHaveBeenCalledWith('order_id', 'order-1');
    expect(updateBuilder.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(updateBuilder.eq).toHaveBeenCalledWith(
      'gateway_reference',
      'BAC-OLD'
    );
    expect(updateBuilder.eq).toHaveBeenCalledWith('status', 'pending');
  });

  it('retires a provider-confirmed processing attempt on a funded order', async () => {
    const { client, updateBuilder } = createClient([
      { ...candidate, status: 'processing' },
    ]);
    const verify = vi.fn().mockResolvedValue({
      success: true,
      data: {
        reference: 'BAC-OLD',
        status: 'abandoned',
        amount: 10000,
        currency: 'NGN',
      },
    });

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify,
    });

    expect(summary.retired).toEqual(['attempt-1']);
    expect(updateBuilder.eq).toHaveBeenCalledWith('status', 'processing');
  });

  it('retires an old DVA placeholder only when Paystack confirms its reference is missing', async () => {
    const { client, update } = createClient([
      { ...candidate, metadata: { paystack_payment_type: 'dva' } },
    ]);
    const verify = vi.fn().mockResolvedValue({
      success: false,
      code: 'HTTP_404',
    });

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify,
    });

    expect(summary.retired).toEqual(['attempt-1']);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('holds an unmarked card attempt even when another DVA payment completed', async () => {
    const { client, update } = createClient([candidate], { dvaSibling: true });
    const verify = vi.fn().mockResolvedValue({
      success: false,
      code: 'HTTP_404',
    });

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify,
    });

    expect(summary.retired).toEqual([]);
    expect(summary.held).toEqual([
      { id: 'attempt-1', reason: 'verification_unavailable' },
    ]);
    expect(update).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('holds an unmarked 404 when no completed DVA payment proves a placeholder', async () => {
    const { client, update } = createClient();
    const verify = vi.fn().mockResolvedValue({
      success: false,
      code: 'HTTP_404',
    });

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify,
    });

    expect(summary.retired).toEqual([]);
    expect(summary.held).toEqual([
      { id: 'attempt-1', reason: 'verification_unavailable' },
    ]);
    expect(update).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });

  it.each([
    'pending',
    'success',
  ])('preserves an attempt when Paystack reports %s', async (status) => {
    const { client, update } = createClient();
    const verify = vi.fn().mockResolvedValue({
      success: true,
      data: { reference: 'BAC-OLD', status, amount: 10000, currency: 'NGN' },
    });

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify,
    });

    expect(summary.retired).toEqual([]);
    expect(summary.held).toEqual([{ id: 'attempt-1', reason: status }]);
    expect(update).toHaveBeenCalledWith({
      updated_at: expect.any(String),
    });
  });

  it('fails closed when provider verification is unavailable or mismatched', async () => {
    const { client, update } = createClient();
    const verify = vi
      .fn()
      .mockResolvedValueOnce({ success: false, code: 'HTTP_503' })
      .mockResolvedValueOnce({
        success: true,
        data: {
          reference: 'OTHER',
          status: 'abandoned',
          amount: 10000,
          currency: 'NGN',
        },
      });

    const first = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify,
    });
    const second = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify,
    });

    expect(first.held).toEqual([
      { id: 'attempt-1', reason: 'verification_unavailable' },
    ]);
    expect(second.held).toEqual([
      { id: 'attempt-1', reason: 'reference_mismatch' },
    ]);
    expect(update).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });

  it.each([
    { amount: 9900, currency: 'NGN' },
    { amount: 10000, currency: 'USD' },
  ])('holds a verified abandoned attempt with mismatched payment evidence', async (evidence) => {
    const { client, update } = createClient();
    const verify = vi.fn().mockResolvedValue({
      success: true,
      data: { reference: 'BAC-OLD', status: 'abandoned', ...evidence },
    });

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify,
    });

    expect(summary.retired).toEqual([]);
    expect(summary.held).toEqual([
      { id: 'attempt-1', reason: 'payment_evidence_mismatch' },
    ]);
    expect(update).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('records a rotation failure once for the held attempt', async () => {
    const { client, updateBuilder } = createClient();
    Object.assign(updateBuilder, {
      // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are awaited thenables.
      then: (resolve: (result: { error: Error }) => void) =>
        resolve({ error: new Error('rotation unavailable') }),
    });
    const verify = vi.fn().mockResolvedValue({
      success: true,
      data: {
        reference: 'BAC-OLD',
        status: 'pending',
        amount: 10000,
        currency: 'NGN',
      },
    });

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify,
    });

    expect(summary.held).toEqual([
      { id: 'attempt-1', reason: 'pending', rotationFailed: true },
    ]);
  });

  it.each([
    [{ paid: false, completed: true }, 'order_not_paid_or_unavailable'],
    [{ paid: true, completed: false }, 'no_completed_payment_or_unavailable'],
  ])('holds a pending attempt without a paid order and another completed payment', async (scope, reason) => {
    const { client, update } = createClient([candidate], scope);
    const verify = vi.fn();
    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify,
    });

    expect(summary.retired).toEqual([]);
    expect(summary.held).toEqual([{ id: 'attempt-1', reason }]);
    expect(verify).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });
});

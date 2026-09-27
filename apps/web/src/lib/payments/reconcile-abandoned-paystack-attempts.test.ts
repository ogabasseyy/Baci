import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileAbandonedPaystackAttempts } from './reconcile-abandoned-paystack-attempts';

const candidate = {
  id: 'attempt-1',
  order_id: 'order-1',
  merchant_id: 'merchant-1',
  gateway_reference: 'BAC-OLD',
};

function createClient(
  rows = [candidate],
  { paid = true, completed = true } = {}
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
    neq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
  };
  const orderLookup = {
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: paid ? { id: 'order-1' } : null,
      error: null,
    }),
  };
  const completedLookup = {
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({
      data: completed ? [{ id: 'paid-attempt' }] : [],
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
      data: { reference: 'BAC-OLD', status },
    });

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify,
    });

    expect(summary.retired).toEqual(['attempt-1']);
    expect(lookup.eq).toHaveBeenCalledWith('gateway', 'paystack');
    expect(lookup.eq).toHaveBeenCalledWith('status', 'pending');
    expect(lookup.lt).toHaveBeenCalledWith('updated_at', expect.any(String));
    expect(orderLookup.eq).toHaveBeenCalledWith('payment_status', 'paid');
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

  it.each([
    'pending',
    'success',
  ])('preserves an attempt when Paystack reports %s', async (status) => {
    const { client, update } = createClient();
    const verify = vi.fn().mockResolvedValue({
      success: true,
      data: { reference: 'BAC-OLD', status },
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
        data: { reference: 'OTHER', status: 'abandoned' },
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

  it('records a rotation failure once for the held attempt', async () => {
    const { client, updateBuilder } = createClient();
    Object.assign(updateBuilder, {
      // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are awaited thenables.
      then: (resolve: (result: { error: Error }) => void) =>
        resolve({ error: new Error('rotation unavailable') }),
    });
    const verify = vi.fn().mockResolvedValue({
      success: true,
      data: { reference: 'BAC-OLD', status: 'pending' },
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

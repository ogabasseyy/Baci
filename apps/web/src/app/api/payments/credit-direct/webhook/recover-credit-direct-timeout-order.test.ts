import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { recoverCreditDirectTimeoutOrder } from './recover-credit-direct-timeout-order';

const reinstate = vi.hoisted(() => vi.fn());
vi.mock('@/lib/payments/reinstate-timeout-order-payment', () => ({
  reinstateTimeoutOrderPayment: reinstate,
}));

function mockRecovery(
  notes: string,
  error: { message: string } | null = null,
  orderState: {
    cancelled_at: string | null;
    paid_transaction_id: string | null;
    payment_status: string;
    shipping_status: string;
  } = {
    cancelled_at: null,
    paid_transaction_id: 'transaction',
    payment_status: 'paid',
    shipping_status: 'processing',
  }
) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi
      .fn()
      .mockResolvedValue({ data: { notes, ...orderState }, error }),
  };
  const from = vi.fn().mockReturnValue(query);
  return {
    query,
    input: {
      merchantId: 'merchant',
      orderId: 'order',
      resume: vi.fn().mockResolvedValue('processed'),
      supabase: { from } as unknown as SupabaseClient,
      transactionId: 'transaction',
    },
  };
}

describe('recoverCreditDirectTimeoutOrder', () => {
  it('resumes only when both fee amounts are available', async () => {
    reinstate.mockResolvedValue('reinstated');
    const { input, query } = mockRecovery(
      '{"platformFee":10,"merchantAmount":100}'
    );
    await expect(recoverCreditDirectTimeoutOrder(input)).resolves.toEqual({
      kind: 'recovered',
      response: 'processed',
    });
    expect(query.eq).toHaveBeenCalledWith('merchant_id', 'merchant');
    expect(input.resume).toHaveBeenCalledWith({
      merchantAmount: 100,
      platformFee: 10,
    });
  });

  it.each([
    '{}',
    '{"merchantAmount":100}',
    'invalid',
    '[]',
    'null',
  ])('requires reconciliation when post-commit fee evidence is missing: %s', async (notes) => {
    reinstate.mockResolvedValue('reinstated');
    const { input } = mockRecovery(notes);
    await expect(recoverCreditDirectTimeoutOrder(input)).resolves.toEqual({
      kind: 'review_required',
    });
    expect(input.resume).not.toHaveBeenCalled();
  });

  it('requires reconciliation for invalid fee values', async () => {
    reinstate.mockResolvedValue('reinstated');
    const { input } = mockRecovery('{"platformFee":-1,"merchantAmount":"NaN"}');
    await expect(recoverCreditDirectTimeoutOrder(input)).resolves.toEqual({
      kind: 'review_required',
    });
    expect(input.resume).not.toHaveBeenCalled();
  });

  it('does not resume when the order is no longer paid by this transaction', async () => {
    reinstate.mockResolvedValue('already_reinstated');
    const { input, query } = mockRecovery(
      '{"platformFee":10,"merchantAmount":100}',
      null,
      {
        cancelled_at: '2026-11-27T10:00:00Z',
        paid_transaction_id: 'another-transaction',
        payment_status: 'cancelled',
        shipping_status: 'cancelled',
      }
    );

    await expect(recoverCreditDirectTimeoutOrder(input)).resolves.toEqual({
      kind: 'review_required',
    });
    expect(query.select).toHaveBeenCalledWith(
      'notes, payment_status, shipping_status, cancelled_at, paid_transaction_id'
    );
    expect(input.resume).not.toHaveBeenCalled();
  });

  it('leaves a blocked timeout in the original reconciliation flow', async () => {
    reinstate.mockResolvedValue('blocked');
    const { input, query } = mockRecovery('{}');
    await expect(recoverCreditDirectTimeoutOrder(input)).resolves.toEqual({
      kind: 'blocked',
    });
    expect(query.maybeSingle).not.toHaveBeenCalled();
    expect(input.resume).not.toHaveBeenCalled();
  });

  it('requests reconciliation when reinstatement throws after capture was recorded', async () => {
    reinstate.mockRejectedValue(new Error('RPC unavailable'));
    const { input, query } = mockRecovery('{}');
    await expect(recoverCreditDirectTimeoutOrder(input)).resolves.toEqual({
      kind: 'review_required',
    });
    expect(query.maybeSingle).not.toHaveBeenCalled();
  });

  it('returns without an RPC when the transaction ID is missing', async () => {
    reinstate.mockClear();
    const { input } = mockRecovery('{}');
    await expect(
      recoverCreditDirectTimeoutOrder({ ...input, transactionId: null })
    ).resolves.toEqual({ kind: 'blocked' });
    expect(reinstate).not.toHaveBeenCalled();
  });

  it('files the existing reconciliation path when the reinstated order cannot be read', async () => {
    reinstate.mockResolvedValue('already_reinstated');
    const { input, query } = mockRecovery('{}', { message: 'Unavailable' });
    query.maybeSingle
      .mockResolvedValueOnce({ data: null, error: { message: 'Unavailable' } })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'Still unavailable' },
      });
    await expect(recoverCreditDirectTimeoutOrder(input)).resolves.toEqual({
      kind: 'review_required',
    });
    expect(query.maybeSingle).toHaveBeenCalledTimes(2);
    expect(input.resume).not.toHaveBeenCalled();
  });

  it('retries one transient notes read failure and resumes after the committed flip', async () => {
    reinstate.mockResolvedValue('reinstated');
    const { input, query } = mockRecovery('{}');
    query.maybeSingle
      .mockResolvedValueOnce({ data: null, error: { message: 'Unavailable' } })
      .mockResolvedValueOnce({
        data: {
          cancelled_at: null,
          notes: '{"platformFee":10,"merchantAmount":100}',
          paid_transaction_id: 'transaction',
          payment_status: 'paid',
          shipping_status: 'processing',
        },
        error: null,
      });

    await expect(recoverCreditDirectTimeoutOrder(input)).resolves.toEqual({
      kind: 'recovered',
      response: 'processed',
    });
    expect(query.maybeSingle).toHaveBeenCalledTimes(2);
    expect(input.resume).toHaveBeenCalledWith({
      merchantAmount: 100,
      platformFee: 10,
    });
  });
});

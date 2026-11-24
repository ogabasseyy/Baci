import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { recoverCreditDirectTimeoutOrder } from './recover-credit-direct-timeout-order';

const reinstate = vi.hoisted(() => vi.fn());
vi.mock('@/lib/payments/reinstate-timeout-order-payment', () => ({
  reinstateTimeoutOrderPayment: reinstate,
}));

function mockRecovery(notes: string, error: { message: string } | null = null) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { notes }, error }),
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

  it('leaves a blocked timeout in the original reconciliation flow', async () => {
    reinstate.mockResolvedValue('blocked');
    const { input, query } = mockRecovery('{}');
    await expect(recoverCreditDirectTimeoutOrder(input)).resolves.toEqual({
      kind: 'blocked',
    });
    expect(query.single).not.toHaveBeenCalled();
    expect(input.resume).not.toHaveBeenCalled();
  });

  it('requests reconciliation when reinstatement throws after capture was recorded', async () => {
    reinstate.mockRejectedValue(new Error('RPC unavailable'));
    const { input, query } = mockRecovery('{}');
    await expect(recoverCreditDirectTimeoutOrder(input)).resolves.toEqual({
      kind: 'review_required',
    });
    expect(query.single).not.toHaveBeenCalled();
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
    query.single
      .mockResolvedValueOnce({ data: null, error: { message: 'Unavailable' } })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'Still unavailable' },
      });
    await expect(recoverCreditDirectTimeoutOrder(input)).resolves.toEqual({
      kind: 'review_required',
    });
    expect(query.single).toHaveBeenCalledTimes(2);
    expect(input.resume).not.toHaveBeenCalled();
  });

  it('retries one transient notes read failure and resumes after the committed flip', async () => {
    reinstate.mockResolvedValue('reinstated');
    const { input, query } = mockRecovery('{}');
    query.single
      .mockResolvedValueOnce({ data: null, error: { message: 'Unavailable' } })
      .mockResolvedValueOnce({
        data: { notes: '{"platformFee":10,"merchantAmount":100}' },
        error: null,
      });

    await expect(recoverCreditDirectTimeoutOrder(input)).resolves.toEqual({
      kind: 'recovered',
      response: 'processed',
    });
    expect(query.single).toHaveBeenCalledTimes(2);
    expect(input.resume).toHaveBeenCalledWith({
      merchantAmount: 100,
      platformFee: 10,
    });
  });
});

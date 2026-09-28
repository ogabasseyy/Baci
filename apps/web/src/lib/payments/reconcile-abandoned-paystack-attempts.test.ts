import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileAbandonedPaystackAttempts } from './reconcile-abandoned-paystack-attempts';
import {
  candidate,
  createClient,
} from './reconcile-abandoned-paystack-attempts.test-support';

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
    expect(lookup.lt).toHaveBeenCalledWith('created_at', expect.any(String));
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
  ])('preserves an attempt when Paystack reports %s', async (status) => {
    const { client, lookup, update } = createClient();
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
    const rotatedAt = (
      update.mock.calls as unknown as [{ updated_at: string }][]
    )[0]?.[0].updated_at;
    const retryCutoff = lookup.lt.mock.calls[1]?.[1] as string;
    expect(Date.parse(rotatedAt)).toBeGreaterThan(Date.parse(retryCutoff));
    expect(Date.parse(rotatedAt)).toBeLessThanOrEqual(Date.now());
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
          status: 'pending',
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

    expect(summary.failed).toBe(true);
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

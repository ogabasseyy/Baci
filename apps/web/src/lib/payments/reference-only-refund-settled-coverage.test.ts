import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { referenceOnlyRefundCoveredBySettledRows } from './reference-only-refund-settled-coverage';

function args(overrides = {}) {
  return {
    amount: 100,
    currency: 'NGN',
    merchantId: 'merchant-1',
    orderId: 'order-1',
    paymentId: 'pay-1',
    ...overrides,
  };
}

function linkedRefund(amount: number, status = 'processed', currency = 'NGN') {
  return {
    amount,
    currency,
    metadata: { provider_refund_status: status },
  };
}

function selectQuery(data: unknown, error: unknown = null) {
  return {
    eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are thenable.
    then: (resolve: (value: unknown) => void) => resolve({ data, error }),
  };
}

describe('referenceOnlyRefundCoveredBySettledRows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when linked verified refunds cover the payment', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(selectQuery([linkedRefund(60), linkedRefund(40)]));
    const supabase = { from, rpc: vi.fn() } as unknown as SupabaseClient;

    await expect(
      referenceOnlyRefundCoveredBySettledRows(supabase, args())
    ).resolves.toBe(true);
    expect(from).toHaveBeenCalledWith('transactions');
  });

  it('returns false on partial coverage and ignores unverified rows', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(
        selectQuery([linkedRefund(40), linkedRefund(100, 'pending')])
      )
      .mockReturnValueOnce(selectQuery([]));
    const supabase = { from, rpc: vi.fn() } as unknown as SupabaseClient;

    // The pending 100 NGN row is not provider-verified, so 40 of 100
    // NGN covered leaves a balance the event may evidence.
    await expect(
      referenceOnlyRefundCoveredBySettledRows(supabase, args())
    ).resolves.toBe(false);
  });

  it('ignores linked refunds in another currency', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(selectQuery([linkedRefund(100, 'processed', 'GHS')]))
      .mockReturnValueOnce(selectQuery([]));
    const supabase = { from, rpc: vi.fn() } as unknown as SupabaseClient;

    await expect(
      referenceOnlyRefundCoveredBySettledRows(supabase, args())
    ).resolves.toBe(false);
  });

  it('returns true under the sole-paystack-payment legacy rule', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(selectQuery([]))
      .mockReturnValueOnce(
        selectQuery([{ amount: 100, currency: 'NGN', gateway: 'paystack' }])
      )
      .mockReturnValueOnce(selectQuery([linkedRefund(100)]));
    const supabase = { from, rpc: vi.fn() } as unknown as SupabaseClient;

    await expect(
      referenceOnlyRefundCoveredBySettledRows(supabase, args())
    ).resolves.toBe(true);
  });

  it('returns false when the order has several external payments', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(selectQuery([]))
      .mockReturnValueOnce(
        selectQuery([
          { amount: 60, currency: 'NGN', gateway: 'paystack' },
          { amount: 40, currency: 'NGN', gateway: 'paystack' },
        ])
      );
    const supabase = { from, rpc: vi.fn() } as unknown as SupabaseClient;

    await expect(
      referenceOnlyRefundCoveredBySettledRows(supabase, args())
    ).resolves.toBe(false);
    // No legacy-refund lookup runs once the sole-payment rule fails.
    expect(from).toHaveBeenCalledTimes(2);
  });

  it('throws when any settled lookup fails', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(selectQuery(null, new Error('db down')));
    const supabase = { from, rpc: vi.fn() } as unknown as SupabaseClient;

    await expect(
      referenceOnlyRefundCoveredBySettledRows(supabase, args())
    ).rejects.toThrow('refund_event_lookup_failed');
  });
});

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));

import { resolveCancellationRefundOutcome } from './resolve-cancellation-refund-outcome';

const leg = (over: Record<string, unknown> = {}) => ({
  amount: 5000,
  currency: 'NGN',
  gateway: 'paystack',
  gateway_reference: 'ref',
  id: 'leg-1',
  payment_transaction_id: null,
  status: 'completed',
  transaction_type: 'payment',
  ...over,
});

function supabaseWith({
  evidence = { data: false, error: null } as unknown,
  ledger = { data: [leg()], error: null } as unknown,
  mode = {
    data: { cancellation_refund_mode: 'automatic', currency: 'NGN' },
    error: null,
  },
}: {
  evidence?: unknown;
  ledger?: unknown;
  mode?: unknown;
} = {}) {
  const chain: Record<string, unknown> = {};
  chain.eq = vi.fn(() => chain);
  chain.in = vi.fn().mockResolvedValue(ledger);
  return {
    rpc: vi.fn().mockResolvedValue(evidence),
    from: vi.fn((table: string) =>
      table === 'orders'
        ? {
            select: () => ({
              eq: () => ({
                eq: () => ({ maybeSingle: vi.fn().mockResolvedValue(mode) }),
              }),
            }),
          }
        : { select: () => chain }
    ),
  } as never;
}

const base = { merchantId: 'm1', orderId: 'o1' };
const manual = {
  ...base,
  alreadyCancelled: false,
  requested: 'manual' as const,
};

describe('resolveCancellationRefundOutcome', () => {
  it('reports a queued automatic refund without reading the ledger', async () => {
    await expect(
      resolveCancellationRefundOutcome({
        ...base,
        alreadyCancelled: false,
        requested: 'automatic',
        supabase: supabaseWith(),
      })
    ).resolves.toEqual({ outcome: 'queued_if_required' });
  });

  it('reports manual_required with the remaining amount for a cancel-only order', async () => {
    await expect(
      resolveCancellationRefundOutcome({ ...manual, supabase: supabaseWith() })
    ).resolves.toEqual({
      details: { currency: 'NGN', inFlightAmount: 0, remainingAmount: 5000 },
      outcome: 'manual_required',
    });
  });

  it('splits the in-flight amount from what the merchant must refund', async () => {
    const supabase = supabaseWith({
      ledger: {
        data: [
          leg({ amount: 3000 }),
          leg({ amount: 2000, id: 'leg-2', status: 'refund_pending' }),
        ],
        error: null,
      },
    });
    await expect(
      resolveCancellationRefundOutcome({ ...manual, supabase })
    ).resolves.toEqual({
      details: { currency: 'NGN', inFlightAmount: 2000, remainingAmount: 3000 },
      outcome: 'manual_required',
    });
  });

  it('needs nothing from the merchant when everything is already in flight', async () => {
    const supabase = supabaseWith({
      ledger: { data: [leg({ status: 'refund_pending' })], error: null },
    });
    await expect(
      resolveCancellationRefundOutcome({ ...manual, supabase })
    ).resolves.toEqual({
      details: { currency: 'NGN', inFlightAmount: 5000, remainingAmount: 0 },
      outcome: 'queued_if_required',
    });
  });

  it('reports unknown when the ledger or the persisted mode cannot be read', async () => {
    await expect(
      resolveCancellationRefundOutcome({
        ...manual,
        supabase: supabaseWith({
          ledger: { data: null, error: { message: 'x' } },
        }),
      })
    ).resolves.toEqual({ outcome: 'unknown' });
    await expect(
      resolveCancellationRefundOutcome({
        ...manual,
        alreadyCancelled: true,
        supabase: supabaseWith({
          mode: { data: null, error: { message: 'x' } },
        }),
      })
    ).resolves.toEqual({ outcome: 'unknown' });
  });

  it('uses the persisted automatic mode on a replay that asked for manual', async () => {
    await expect(
      resolveCancellationRefundOutcome({
        ...manual,
        alreadyCancelled: true,
        supabase: supabaseWith(),
      })
    ).resolves.toEqual({ outcome: 'queued_if_required' });
  });

  it('does not ask for a manual refund on a replay once the full refund was recorded', async () => {
    const supabase = supabaseWith({
      ledger: {
        data: [
          leg(),
          leg({
            id: 'refund-1',
            payment_transaction_id: 'leg-1',
            transaction_type: 'refund',
          }),
        ],
        error: null,
      },
      mode: { data: { cancellation_refund_mode: 'manual' }, error: null },
    });
    await expect(
      resolveCancellationRefundOutcome({
        ...manual,
        alreadyCancelled: true,
        supabase,
      })
    ).resolves.toEqual({
      details: { currency: 'NGN', inFlightAmount: 0, remainingAmount: 0 },
      outcome: 'queued_if_required',
    });
  });

  it('treats a pending refund row as in flight, not as owed by the merchant', async () => {
    const supabase = supabaseWith({
      ledger: {
        data: [
          leg(),
          leg({
            id: 'refund-1',
            payment_transaction_id: 'leg-1',
            status: 'processing',
            transaction_type: 'refund',
          }),
        ],
        error: null,
      },
    });
    await expect(
      resolveCancellationRefundOutcome({ ...manual, supabase })
    ).resolves.toEqual({
      details: { currency: 'NGN', inFlightAmount: 5000, remainingAmount: 0 },
      outcome: 'queued_if_required',
    });
  });

  it('reports unknown when an unlinked refund cannot be attributed to one leg', async () => {
    const supabase = supabaseWith({
      ledger: {
        data: [
          leg({ id: 'a' }),
          leg({ id: 'b' }),
          leg({
            id: 'refund-1',
            payment_transaction_id: null,
            transaction_type: 'refund',
          }),
        ],
        error: null,
      },
    });
    await expect(
      resolveCancellationRefundOutcome({ ...manual, supabase })
    ).resolves.toEqual({ outcome: 'unknown' });
  });

  it('reports unknown for an unlinked in-flight refund even with a single payment leg', async () => {
    const supabase = supabaseWith({
      ledger: {
        data: [
          leg(),
          leg({
            id: 'refund-1',
            payment_transaction_id: null,
            status: 'processing',
            transaction_type: 'refund',
          }),
        ],
        error: null,
      },
    });
    await expect(
      resolveCancellationRefundOutcome({ ...manual, supabase })
    ).resolves.toEqual({ outcome: 'unknown' });
  });

  it('reports unknown when a refund is linked to a payment this order does not have', async () => {
    const supabase = supabaseWith({
      ledger: {
        data: [
          leg(),
          leg({
            id: 'refund-1',
            payment_transaction_id: 'pay-gone',
            transaction_type: 'refund',
          }),
        ],
        error: null,
      },
    });
    await expect(
      resolveCancellationRefundOutcome({ ...manual, supabase })
    ).resolves.toEqual({ outcome: 'unknown' });
  });

  it('reports the currency code normalized like the worker', async () => {
    const supabase = supabaseWith({
      ledger: { data: [leg({ currency: ' ngn ' })], error: null },
    });
    await expect(
      resolveCancellationRefundOutcome({ ...manual, supabase })
    ).resolves.toMatchObject({ details: { currency: 'NGN' } });
  });

  it('reports unknown while an unresolved movement review is open', async () => {
    await expect(
      resolveCancellationRefundOutcome({
        ...manual,
        supabase: supabaseWith({ evidence: { data: true, error: null } }),
      })
    ).resolves.toEqual({ outcome: 'unknown' });
  });

  it('reports unknown when the movement-evidence check fails', async () => {
    await expect(
      resolveCancellationRefundOutcome({
        ...manual,
        supabase: supabaseWith({
          evidence: { data: null, error: { message: 'x' } },
        }),
      })
    ).resolves.toEqual({ outcome: 'unknown' });
  });

  it('reports unknown for a single USD capture on an NGN order', async () => {
    const supabase = supabaseWith({
      ledger: { data: [leg({ currency: 'USD' })], error: null },
    });
    await expect(
      resolveCancellationRefundOutcome({ ...manual, supabase })
    ).resolves.toEqual({ outcome: 'unknown' });
  });

  it('defaults a blank order currency to NGN like the worker', async () => {
    const supabase = supabaseWith({
      mode: {
        data: { cancellation_refund_mode: 'manual', currency: '' },
        error: null,
      },
    });
    await expect(
      resolveCancellationRefundOutcome({ ...manual, supabase })
    ).resolves.toMatchObject({ outcome: 'manual_required' });
  });

  it('reports unknown when the order currency cannot be read', async () => {
    const supabase = supabaseWith({
      mode: { data: null, error: { message: 'x' } },
    });
    await expect(
      resolveCancellationRefundOutcome({ ...manual, supabase })
    ).resolves.toEqual({ outcome: 'unknown' });
  });
});

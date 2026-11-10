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
  ledger = { data: [leg()], error: null } as unknown,
  mode = { data: { cancellation_refund_mode: 'automatic' }, error: null },
}: {
  ledger?: unknown;
  mode?: unknown;
} = {}) {
  const chain: Record<string, unknown> = {};
  chain.eq = vi.fn(() => chain);
  chain.in = vi.fn().mockResolvedValue(ledger);
  return {
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
});

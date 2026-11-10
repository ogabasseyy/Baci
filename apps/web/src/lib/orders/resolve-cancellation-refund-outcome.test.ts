import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));

import { resolveCancellationRefundOutcome } from './resolve-cancellation-refund-outcome';

function supabaseWith({
  legs = { data: [], error: null } as unknown,
  mode = { data: { cancellation_refund_mode: 'automatic' }, error: null },
}: {
  legs?: unknown;
  mode?: unknown;
} = {}) {
  const chain: Record<string, unknown> = {};
  chain.eq = vi.fn(() => chain);
  chain.limit = vi.fn().mockResolvedValue(legs);
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

describe('resolveCancellationRefundOutcome', () => {
  it('reports a queued automatic refund', async () => {
    await expect(
      resolveCancellationRefundOutcome({
        ...base,
        alreadyCancelled: false,
        requested: 'automatic',
        supabase: supabaseWith(),
      })
    ).resolves.toBe('queued_if_required');
  });

  it('reports manual_required only when no leg refund is in flight', async () => {
    await expect(
      resolveCancellationRefundOutcome({
        ...base,
        alreadyCancelled: false,
        requested: 'manual',
        supabase: supabaseWith(),
      })
    ).resolves.toBe('manual_required');
  });

  it('reports unknown for a manual cancellation with a refund in flight', async () => {
    await expect(
      resolveCancellationRefundOutcome({
        ...base,
        alreadyCancelled: false,
        requested: 'manual',
        supabase: supabaseWith({ legs: { data: [{ id: 'l' }], error: null } }),
      })
    ).resolves.toBe('unknown');
  });

  it('reports unknown when the in-flight check or the persisted read fails', async () => {
    await expect(
      resolveCancellationRefundOutcome({
        ...base,
        alreadyCancelled: false,
        requested: 'manual',
        supabase: supabaseWith({
          legs: { data: null, error: { message: 'x' } },
        }),
      })
    ).resolves.toBe('unknown');
    await expect(
      resolveCancellationRefundOutcome({
        ...base,
        alreadyCancelled: true,
        requested: 'manual',
        supabase: supabaseWith({
          mode: { data: null, error: { message: 'x' } },
        }),
      })
    ).resolves.toBe('unknown');
  });

  it('uses the persisted automatic mode on a replay that asked for manual', async () => {
    await expect(
      resolveCancellationRefundOutcome({
        ...base,
        alreadyCancelled: true,
        requested: 'manual',
        supabase: supabaseWith(),
      })
    ).resolves.toBe('queued_if_required');
  });
});

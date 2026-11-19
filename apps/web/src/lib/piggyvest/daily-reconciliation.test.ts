import { describe, expect, it, vi } from 'vitest';
import { runDailyReconciliation } from './daily-reconciliation';
import {
  GENERATED_AT,
  NOW,
  ports,
  snapshot,
  stuck,
} from './daily-reconciliation.test-support';

describe('runDailyReconciliation', () => {
  it('is clean when nothing is stuck and every balance matches', async () => {
    const report = await runDailyReconciliation(
      ports(
        snapshot({
          wallets: [
            { walletId: 'goal-a', expectedKobo: 1500 },
            { walletId: 'goal-c', expectedKobo: 200 },
          ],
          walletsTotal: 2,
        }),
        {
          readWalletBalance: vi.fn(async (id) =>
            id === 'goal-a' ? 1500 : 200
          ),
        }
      )
    );
    expect(report).toMatchObject({
      status: 'clean',
      generatedAt: GENERATED_AT,
      reasons: [],
      stuck: [],
    });
    if (report.status === 'failed') throw new Error('unreachable');
    expect(report.balances.map((b) => b.kind)).toEqual(['match', 'match']);
  });

  it('treats a balance above the recorded principal as interest to review, not a page', async () => {
    const report = await runDailyReconciliation(
      ports(
        snapshot({
          wallets: [{ walletId: 'goal-a', expectedKobo: 1500 }],
          walletsTotal: 1,
        }),
        {
          readWalletBalance: vi.fn(async () => 1650),
        }
      )
    );
    if (report.status === 'failed') throw new Error('unreachable');
    expect(report.status).toBe('clean');
    expect(report.balances[0]).toEqual({
      walletId: 'goal-a',
      expectedKobo: 1500,
      providerKobo: 1650,
      differenceKobo: 150,
      kind: 'above_expected',
    });
  });

  it('needs attention when PiggyVest holds less than we recorded', async () => {
    const report = await runDailyReconciliation(
      ports(
        snapshot({
          wallets: [{ walletId: 'goal-a', expectedKobo: 1500 }],
          walletsTotal: 1,
        }),
        {
          readWalletBalance: vi.fn(async () => 1000),
        }
      )
    );
    if (report.status === 'failed') throw new Error('unreachable');
    expect(report.status).toBe('attention');
    expect(report.reasons).toEqual(['balance_below_expected']);
    expect(report.balances[0]).toMatchObject({
      kind: 'below_expected',
      differenceKobo: -500,
    });
  });

  it.each([
    [
      'a thrown read',
      async () => {
        throw new Error('boom');
      },
    ],
    ['a fractional balance', async () => 10.5],
    ['a negative balance', async () => -1],
    ['a non-number', async () => '1500' as unknown as number],
    ['NaN', async () => Number.NaN],
  ])('needs attention when the provider balance is unreadable (%s)', async (_l, read) => {
    const report = await runDailyReconciliation(
      ports(
        snapshot({
          wallets: [{ walletId: 'goal-a', expectedKobo: 1500 }],
          walletsTotal: 1,
        }),
        {
          readWalletBalance: vi.fn(read),
        }
      )
    );
    if (report.status === 'failed') throw new Error('unreachable');
    expect(report.status).toBe('attention');
    expect(report.reasons).toEqual(['balance_unreadable']);
    expect(report.balances[0]).toMatchObject({
      kind: 'unreadable',
      providerKobo: null,
      differenceKobo: null,
    });
  });

  it('lists every stuck transfer with the status PiggyVest reports, and needs attention', async () => {
    const readings = ['submitted', 'pending', 'failed', 'not_found'] as const;
    const rows = [1, 2, 3, 4].map((n) => stuck(n));
    const readTransfer = vi.fn(async (t: { operationId: string }) => {
      const index = rows.findIndex((r) => r.operationId === t.operationId);
      return readings[index];
    });
    const report = await runDailyReconciliation(
      ports(snapshot({ stuck: rows, stuckTotal: 4 }), { readTransfer })
    );
    if (report.status === 'failed') throw new Error('unreachable');
    expect(report.status).toBe('attention');
    expect(report.reasons).toEqual(['stuck_transfers']);
    expect(report.stuck.map((s) => s.reading)).toEqual([...readings]);
    expect(readTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ reference: 'synthetic-reference-1' }),
      'synthetic-business'
    );
  });

  it('never asks PiggyVest about a transfer that was only reserved', async () => {
    const readTransfer = vi.fn(async () => 'pending' as const);
    const report = await runDailyReconciliation(
      ports(snapshot({ stuck: [stuck(1, 'reserved')], stuckTotal: 1 }), {
        readTransfer,
      })
    );
    if (report.status === 'failed') throw new Error('unreachable');
    expect(readTransfer).not.toHaveBeenCalled();
    expect(report.stuck[0].reading).toBe('not_dispatched');
  });

  it('reads a failed status lookup as uncertain, never as absent', async () => {
    const report = await runDailyReconciliation(
      ports(snapshot({ stuck: [stuck(1)], stuckTotal: 1 }), {
        readTransfer: vi.fn(async () => {
          throw new Error('network');
        }),
      })
    );
    if (report.status === 'failed') throw new Error('unreachable');
    expect(report.stuck[0].reading).toBe('uncertain');
  });

  it('needs attention, with the deferred count, when more transfers are stuck than one window lists', async () => {
    const report = await runDailyReconciliation(
      ports(
        snapshot({ stuck: [stuck(1)], stuckTotal: 250, stuckDeferred: 249 })
      )
    );
    if (report.status === 'failed') throw new Error('unreachable');
    expect(report.status).toBe('attention');
    expect(report.reasons).toEqual(['stuck_transfers', 'list_truncated']);
    expect(report.truncated).toEqual({ stuck: true, wallets: false });
    expect(report.deferred).toEqual({ stuck: 249, wallets: 0 });
  });

  it('reports deferred wallets without paging: rotation checks them on later runs', async () => {
    const report = await runDailyReconciliation(
      ports(
        snapshot({
          wallets: [{ walletId: 'goal-a', expectedKobo: 100 }],
          walletsTotal: 601,
          walletsDeferred: 600,
        }),
        { readWalletBalance: vi.fn(async () => 100) }
      )
    );
    if (report.status === 'failed') throw new Error('unreachable');
    expect(report.status).toBe('clean');
    expect(report.reasons).toEqual([]);
    expect(report.truncated).toEqual({ stuck: false, wallets: true });
    expect(report.deferred).toEqual({ stuck: 0, wallets: 600 });
  });

  it('still pages on a shortfall found in a rotated window', async () => {
    const report = await runDailyReconciliation(
      ports(
        snapshot({
          wallets: [{ walletId: 'goal-a', expectedKobo: 100 }],
          walletsTotal: 601,
          walletsDeferred: 600,
        }),
        { readWalletBalance: vi.fn(async () => 50) }
      )
    );
    if (report.status === 'failed') throw new Error('unreachable');
    expect(report.status).toBe('attention');
    expect(report.reasons).toEqual(['balance_below_expected']);
  });

  it('fails when the snapshot cannot be loaded', async () => {
    const report = await runDailyReconciliation(
      ports(null, {
        loadSnapshot: vi.fn(async () => {
          throw new Error('db down');
        }),
      })
    );
    expect(report).toEqual({
      status: 'failed',
      reason: 'snapshot_unavailable',
      generatedAt: NOW,
    });
  });

  it.each([
    ['null', null],
    ['an extra key', snapshot({ extra: true })],
    ['a missing total', snapshot({ walletsTotal: undefined })],
    ['a string total', snapshot({ stuckTotal: '0' })],
  ])('fails, never reads clean, on a malformed snapshot (%s)', async (_l, value) => {
    const report = await runDailyReconciliation(ports(value));
    expect(report).toEqual({
      status: 'failed',
      reason: 'snapshot_invalid',
      generatedAt: NOW,
    });
  });

  it('reads at most a few provider lookups at once', async () => {
    let active = 0;
    let peak = 0;
    const wallets = Array.from({ length: 12 }, (_, i) => ({
      walletId: `goal-${i}`,
      expectedKobo: 100,
    }));
    const rows = Array.from({ length: 12 }, (_, i) => stuck(i + 1));
    const gate = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      await Promise.resolve();
      active -= 1;
    };
    await runDailyReconciliation(
      ports(
        snapshot({ stuck: rows, stuckTotal: 12, wallets, walletsTotal: 12 }),
        {
          readTransfer: vi.fn(async () => {
            await gate();
            return 'pending' as const;
          }),
          readWalletBalance: vi.fn(async () => {
            await gate();
            return 100;
          }),
        }
      )
    );
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(5);
  });
});

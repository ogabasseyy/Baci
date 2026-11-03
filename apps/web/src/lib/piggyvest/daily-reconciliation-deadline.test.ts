import { describe, expect, it, vi } from 'vitest';
import { runDailyReconciliation } from './daily-reconciliation';
import { ports, snapshot, stuck } from './daily-reconciliation.test-support';

describe('runDailyReconciliation', () => {
  describe('read deadline', () => {
    function clock() {
      let ms = 0;
      return { nowMs: () => ms, advance: (by: number) => (ms += by) };
    }

    it('stops starting reads at the deadline and reports the rest as unchecked', async () => {
      const time = clock();
      const wallets = Array.from({ length: 50 }, (_, i) => ({
        walletId: `goal-${i}`,
        expectedKobo: 100,
      }));
      const readWalletBalance = vi.fn(async () => {
        time.advance(30_000);
        return 100;
      });
      const report = await runDailyReconciliation(
        ports(snapshot({ wallets, walletsTotal: 50 }), {
          readWalletBalance,
          nowMs: time.nowMs,
          deadlineMs: 60_000,
        })
      );
      // The first batch of five uses the whole budget; the rest never start.
      expect(readWalletBalance).toHaveBeenCalledTimes(5);
      if (report.status === 'failed') throw new Error('expected a report');
      expect(report.status).toBe('attention');
      expect(report.balances).toHaveLength(50);
      expect(
        report.balances.filter((balance) => balance.kind === 'unreadable')
      ).toHaveLength(45);
      expect(report.reasons).toContain('read_deadline_reached');
      expect(report.reasons).toContain('balance_unreadable');
    });

    it('marks unstarted dispatched lookups uncertain and skips wallet reads once out of time', async () => {
      const time = clock();
      const rows = Array.from({ length: 12 }, (_, i) => stuck(i + 1));
      const readTransfer = vi.fn(async () => {
        time.advance(5_000);
        return 'pending' as const;
      });
      const readWalletBalance = vi.fn(async () => 100);
      const report = await runDailyReconciliation(
        ports(
          snapshot({
            stuck: rows,
            stuckTotal: 12,
            wallets: [{ walletId: 'goal-a', expectedKobo: 100 }],
            walletsTotal: 1,
          }),
          {
            readTransfer,
            readWalletBalance,
            nowMs: time.nowMs,
            deadlineMs: 10_000,
          }
        )
      );
      expect(readTransfer).toHaveBeenCalledTimes(5);
      expect(readWalletBalance).not.toHaveBeenCalled();
      if (report.status === 'failed') throw new Error('expected a report');
      expect(report.stuck.map((item) => item.reading)).toEqual([
        ...Array(5).fill('pending'),
        ...Array(7).fill('uncertain'),
      ]);
      expect(report.balances[0].kind).toBe('unreadable');
      expect(report.reasons).toContain('read_deadline_reached');
    });

    it('reports unstarted reserved rows as never sent, and unstarted dispatched rows as unconfirmed', async () => {
      const time = clock();
      const rows = [
        ...Array.from({ length: 5 }, (_, i) => stuck(i + 1)),
        stuck(6, 'reserved'),
        stuck(7),
      ];
      const readTransfer = vi.fn(async () => {
        time.advance(10_000);
        return 'pending' as const;
      });
      const report = await runDailyReconciliation(
        ports(snapshot({ stuck: rows, stuckTotal: 7 }), {
          readTransfer,
          nowMs: time.nowMs,
          deadlineMs: 10_000,
        })
      );
      expect(readTransfer).toHaveBeenCalledTimes(5);
      if (report.status === 'failed') throw new Error('expected a report');
      expect(report.stuck.slice(5).map((item) => item.reading)).toEqual([
        'not_dispatched',
        'uncertain',
      ]);
    });

    it('does not flag the deadline when every read finished in time', async () => {
      const time = clock();
      const report = await runDailyReconciliation(
        ports(
          snapshot({
            wallets: [{ walletId: 'goal-a', expectedKobo: 100 }],
            walletsTotal: 1,
          }),
          {
            readWalletBalance: vi.fn(async () => 100),
            nowMs: time.nowMs,
            deadlineMs: 60_000,
          }
        )
      );
      if (report.status === 'failed') throw new Error('expected a report');
      expect(report.status).toBe('clean');
      expect(report.reasons).not.toContain('read_deadline_reached');
    });
  });
});

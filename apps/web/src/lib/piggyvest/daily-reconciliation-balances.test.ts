import { describe, expect, it, vi } from 'vitest';
import { runDailyReconciliation } from './daily-reconciliation';
import { ports, snapshot } from './daily-reconciliation.test-support';

const oneWallet = snapshot({
  wallets: [{ walletId: 'goal-a', expectedKobo: 1500 }],
  walletsTotal: 1,
});

function readsOf(values: Array<number | Error>) {
  let index = 0;
  return vi.fn(async () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    if (value instanceof Error) throw value;
    return value;
  });
}

describe('shortfall confirmation re-read', () => {
  it('does not page when the shortfall is gone on the re-read', async () => {
    const read = readsOf([1000, 1500]);
    const report = await runDailyReconciliation(
      ports(oneWallet, { readWalletBalance: read })
    );
    if (report.status === 'failed') throw new Error('unreachable');
    expect(read).toHaveBeenCalledTimes(2);
    expect(report.status).toBe('clean');
    expect(report.balances[0]).toMatchObject({ kind: 'match' });
  });

  it('pages on the re-read figure when the shortfall persists', async () => {
    const read = readsOf([1000, 900]);
    const report = await runDailyReconciliation(
      ports(oneWallet, { readWalletBalance: read })
    );
    if (report.status === 'failed') throw new Error('unreachable');
    expect(read).toHaveBeenCalledTimes(2);
    expect(report.status).toBe('attention');
    expect(report.reasons).toEqual(['balance_below_expected']);
    expect(report.balances[0]).toMatchObject({
      kind: 'below_expected',
      differenceKobo: -600,
    });
  });

  it('keeps the original shortfall when the re-read cannot be read', async () => {
    const read = readsOf([1000, new Error('boom')]);
    const report = await runDailyReconciliation(
      ports(oneWallet, { readWalletBalance: read })
    );
    if (report.status === 'failed') throw new Error('unreachable');
    expect(report.status).toBe('attention');
    expect(report.balances[0]).toMatchObject({
      kind: 'below_expected',
      differenceKobo: -500,
    });
  });

  it('re-reads only the shortfalls, once each', async () => {
    const read = vi.fn(async (walletId: string) =>
      walletId === 'goal-a' ? 1500 : 2000
    );
    const report = await runDailyReconciliation(
      ports(
        snapshot({
          wallets: [
            { walletId: 'goal-a', expectedKobo: 1500 },
            { walletId: 'goal-b', expectedKobo: 3000 },
          ],
          walletsTotal: 2,
        }),
        { readWalletBalance: read }
      )
    );
    if (report.status === 'failed') throw new Error('unreachable');
    expect(read.mock.calls.map(([id]) => id)).toEqual([
      'goal-a',
      'goal-b',
      'goal-b',
    ]);
    expect(report.balances.map((b) => b.kind)).toEqual([
      'match',
      'below_expected',
    ]);
  });

  it('does not re-read once the read deadline has passed', async () => {
    const read = readsOf([1000, 1500]);
    let calls = 0;
    const report = await runDailyReconciliation(
      ports(oneWallet, {
        readWalletBalance: read,
        deadlineMs: 500,
        nowMs: () => (calls++ === 0 ? 0 : 1000),
      })
    );
    if (report.status === 'failed') throw new Error('unreachable');
    expect(read).toHaveBeenCalledTimes(1);
    expect(report.status).toBe('attention');
    expect(report.reasons).toContain('balance_below_expected');
    expect(report.deadlineReached).toBe(true);
  });
});

describe('surplus', () => {
  const surplus = (providerKobo: number) =>
    runDailyReconciliation(
      ports(oneWallet, { readWalletBalance: vi.fn(async () => providerKobo) })
    );

  it.each([
    1, 100_000, 10_000_000_000,
  ])('never pages for a surplus of %i kobo', async (extra) => {
    const report = await surplus(1500 + extra);
    if (report.status === 'failed') throw new Error('unreachable');
    expect(report.status).toBe('clean');
    expect(report.reasons).toEqual([]);
    expect(report.balances[0]).toMatchObject({
      kind: 'above_expected',
      differenceKobo: extra,
    });
  });
});

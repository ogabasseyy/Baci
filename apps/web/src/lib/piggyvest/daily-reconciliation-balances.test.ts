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

describe('large surplus', () => {
  const surplus = (providerKobo: number, surplusPageKobo?: number) =>
    runDailyReconciliation(
      ports(oneWallet, {
        readWalletBalance: vi.fn(async () => providerKobo),
        ...(surplusPageKobo === undefined ? {} : { surplusPageKobo }),
      })
    );

  it('pages at the named threshold', async () => {
    const report = await surplus(1500 + 5000, 5000);
    if (report.status === 'failed') throw new Error('unreachable');
    expect(report.status).toBe('attention');
    expect(report.reasons).toEqual(['balance_surplus_large']);
    expect(report.balances[0]).toMatchObject({
      kind: 'above_expected_large',
      differenceKobo: 5000,
    });
  });

  it('keeps a smaller surplus as a review, not a page', async () => {
    const report = await surplus(1500 + 4999, 5000);
    if (report.status === 'failed') throw new Error('unreachable');
    expect(report.status).toBe('clean');
    expect(report.balances[0]).toMatchObject({ kind: 'above_expected' });
  });

  it('defaults to 100000 kobo (N1,000)', async () => {
    expect((await surplus(1500 + 99_999)).status).toBe('clean');
    expect((await surplus(1500 + 100_000)).status).toBe('attention');
  });

  it.each([
    0,
    -5,
    1.5,
    Number.NaN,
  ])('falls back to the default for an unusable threshold (%s)', async (bad) => {
    expect((await surplus(1500 + 99_999, bad)).status).toBe('clean');
    expect((await surplus(1500 + 100_000, bad)).status).toBe('attention');
  });
});

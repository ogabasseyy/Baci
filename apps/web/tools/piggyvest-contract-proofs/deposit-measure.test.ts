import { afterEach, describe, expect, it, vi } from 'vitest';
import { measureDeposit } from './deposit-measure';
import { dataOf, type MockPage } from './mock-reply.test-support';
import { fail } from './mock-sandbox-types';
import { createMemoryJournal } from './mutation-journal';
import { setupScenario } from './scenario';
import { makeHarness } from './test-harness.test-support';

let dispose: (() => void) | null = null;
afterEach(() => {
  dispose?.();
  vi.restoreAllMocks();
});
function harness(...args: Parameters<typeof makeHarness>) {
  const h = makeHarness(...args);
  dispose = h.dispose;
  return h;
}

describe('measureDeposit', () => {
  it("measures the credit and finds THIS deposit's row, never an older one of the same amount", async () => {
    // The list lags: the first read after the deposit shows only the older row.
    const h = harness({ mock: { listLagReads: 2 } });
    await setupScenario(h.ctx);
    const main = h.state.mainWalletId ?? '';
    // An older credit of the same gross already sits on the wallet.
    h.mock.sandbox.ledger.fund({ wallet_id: main, amount: 250_000 });
    const readIds = () =>
      dataOf<MockPage>(
        h.mock.sandbox.ledger.listTransactions(
          new URLSearchParams({ wallet_id: main })
        )
      ).edges.map((row) => row.id);
    let older: string[] = [];
    for (let read = 0; read < 3 && older.length === 0; read += 1)
      older = readIds();
    expect(older).not.toHaveLength(0);
    const m = await measureDeposit(h.ctx, main, 250_000, 'p9/fund_main');
    expect(m.kind).toBe('measured');
    if (m.kind !== 'measured') return;
    expect(m.creditedKobo).toBe(245_000);
    expect(m.fundingOutcome).toBe('accepted');
    expect(m.row).not.toBeNull();
    expect(older).not.toContain((m.row as { id: string }).id);
    expect(m.record).toMatchObject({ amount: 250_000, fee: 5_000 });
    expect(m.facts.feeKobo).toBe(5_000);
    expect(m.rowDetail).toBeNull();
  });

  it('reports an unsettled deposit and never measures a credit from it', async () => {
    const h = harness({ mock: { fundingSettles: false } });
    await setupScenario(h.ctx);
    const m = await measureDeposit(
      h.ctx,
      h.state.mainWalletId ?? '',
      250_000,
      'p9/fund_main'
    );
    expect(m).toMatchObject({
      kind: 'unsettled',
      reason: 'the deposit did not settle within the polling window',
    });
  });

  it('guesses no row when the earlier rows could not be read', async () => {
    const h = harness();
    await setupScenario(h.ctx);
    vi.spyOn(h.mock.sandbox.ledger, 'listTransactions').mockReturnValueOnce(
      fail('Service unavailable', 503)
    );
    const m = await measureDeposit(
      h.ctx,
      h.state.mainWalletId ?? '',
      250_000,
      'p9/fund_main'
    );
    expect(m.kind).toBe('measured');
    if (m.kind !== 'measured') return;
    expect(m.row).toBeNull();
    expect(m.rowDetail).toMatch(/earlier rows could not be read/);
  });

  it('resumes instead of funding again on a re-run', async () => {
    const journal = createMemoryJournal();
    const first = harness({ journal });
    await setupScenario(first.ctx);
    await measureDeposit(
      first.ctx,
      first.state.mainWalletId ?? '',
      250_000,
      'p9/fund_main'
    );
    const sandbox = first.mock.sandbox;
    first.dispose();
    const h = harness({ journal });
    h.mock.sandbox.adopt(sandbox);
    await setupScenario(h.ctx);
    const posts = h.mock.calls.filter((c) => c.method === 'POST').length;
    const m = await measureDeposit(
      h.ctx,
      h.state.mainWalletId ?? '',
      250_000,
      'p9/fund_main'
    );
    expect(m).toEqual({ kind: 'resumed', priorOutcome: 'accepted' });
    expect(h.mock.calls.filter((c) => c.method === 'POST').length).toBe(posts);
  });
});

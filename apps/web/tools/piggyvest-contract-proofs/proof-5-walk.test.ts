import { afterEach, describe, expect, it } from 'vitest';
import { runProof5 } from './proof-5-interest';
import { stableWalk, walk } from './proof-5-walk';
import type { CallResult } from './provider-ops';
import { setupScenario } from './scenario';
import { makeHarness } from './test-harness.test-support';
import type { ProofResult } from './types';

let dispose: (() => void) | null = null;
afterEach(() => dispose?.());
function harness(...args: Parameters<typeof makeHarness>) {
  const h = makeHarness(...args);
  dispose = h.dispose;
  return h;
}
const answer = (result: ProofResult, id: string) =>
  result.findings.find((f) => f.id === id)?.answer;

const page = (
  rows: { id: string }[],
  next: string | null,
  ok = true
): CallResult => ({
  ok,
  httpStatus: ok ? 200 : 503,
  data: {
    edges: rows,
    pageInfo: { hasNextPage: next !== null, endCursor: next },
  },
  envelope: null,
  message: null,
  declined: !ok,
  errorCode: null,
  typedAccepted: null,
});
const pager = (pages: CallResult[]) => {
  let index = 0;
  return async () => pages[Math.min(index++, pages.length - 1)];
};

describe('walk', () => {
  it('advances only when every follow-up page brings a row not seen before', async () => {
    const walked = await walk(
      pager([
        page([{ id: 'a' }], '1'),
        page([{ id: 'b' }], '2'),
        page([{ id: 'c' }], null),
      ])
    );
    expect(walked).toMatchObject({
      pages: 3,
      advances: true,
      singlePage: false,
      edgesPerPage: [1, 1, 1],
    });
  });

  it('does not advance when a follow-up page repeats rows, whatever the cursor says', async () => {
    const walked = await walk(
      pager([
        page([{ id: 'a' }], 'x1'),
        page([{ id: 'a' }], 'x2'),
        page([{ id: 'a' }], 'x3'),
      ])
    );
    expect(walked.advances).toBe(false);
  });

  it('stops with advances false when the next cursor repeats', async () => {
    const walked = await walk(
      pager([page([{ id: 'a' }], '1'), page([{ id: 'b' }], '1')])
    );
    expect(walked.advances).toBe(false);
    expect(walked.pages).toBe(2);
  });

  it('knows a single page from a failed follow-up', async () => {
    expect(await walk(pager([page([{ id: 'a' }], null)]))).toMatchObject({
      pages: 1,
      advances: null,
      singlePage: true,
    });
    expect(
      await walk(pager([page([{ id: 'a' }], '1'), page([], null, false)]))
    ).toMatchObject({ pages: 1, advances: null, singlePage: false });
  });

  it('reports nothing for a first page that cannot be read or recognised', async () => {
    expect(await walk(pager([page([], null, false)]))).toMatchObject({
      pages: 0,
      advances: null,
      singlePage: false,
    });
  });
});

describe('stableWalk', () => {
  const ctxFor = (maxPolls: number) =>
    ({
      maxPolls,
      pollIntervalMs: 0,
      sleep: async () => undefined,
    }) as unknown as Parameters<typeof stableWalk>[0];
  const stable = [page([{ id: 'a' }, { id: 'b' }], null)];

  it('walks and returns the settled list when the list holds still', async () => {
    const walked = await stableWalk(
      ctxFor(3),
      pager([page([{ id: 'a' }], '1'), page([{ id: 'b' }], null)]),
      pager(stable)
    );
    expect(walked.advances).toBe(true);
    expect(walked.settledList?.edges).toHaveLength(2);
  });

  it('concludes nothing when the list changes during the polling window', async () => {
    let reads = 0;
    const changing = async () =>
      page(
        Array.from({ length: 1 + (reads++ % 2) }, (_, i) => ({ id: `r${i}` })),
        null
      );
    const walked = await stableWalk(
      ctxFor(3),
      pager([page([{ id: 'a' }], '1'), page([{ id: 'b' }], null)]),
      changing
    );
    expect(walked.advances).toBeNull();
    expect(walked.settledList).toBeNull();
  });

  it('concludes nothing when the list changes after the window, during the walk', async () => {
    let reads = 0;
    const lateChange = async () =>
      page([{ id: 'a' }, ...(reads++ > 3 ? [{ id: 'z' }] : [])], null);
    const walked = await stableWalk(
      ctxFor(3),
      pager([page([{ id: 'a' }], '1'), page([{ id: 'a' }], null)]),
      lateChange
    );
    expect(walked.advances).toBeNull();
    expect(walked.singlePage).toBe(false);
  });

  it('returns no settled snapshot when a row appears after the walk (the post-walk read invalidates it)', async () => {
    let reads = 0;
    const lateRow = async () =>
      page([{ id: 'a' }, ...(reads++ > 3 ? [{ id: 'z' }] : [])], null);
    const walked = await stableWalk(
      ctxFor(3),
      pager([page([{ id: 'a' }], '1'), page([{ id: 'b' }], null)]),
      lateRow
    );
    expect(walked.settledList).toBeNull();
    expect(walked.settledCall).toBeNull();
  });

  it('returns no settled snapshot when the post-walk read fails', async () => {
    let reads = 0;
    const failsAfterWalk = async () =>
      reads++ > 3 ? page([], null, false) : page([{ id: 'a' }], null);
    const walked = await stableWalk(
      ctxFor(3),
      pager([page([{ id: 'a' }], '1'), page([{ id: 'b' }], null)]),
      failsAfterWalk
    );
    expect(walked.settledList).toBeNull();
    expect(walked.settledCall).toBeNull();
  });

  it('does not call a never-readable list settled', async () => {
    const walked = await stableWalk(
      ctxFor(2),
      pager([page([], null, false)]),
      pager([page([], null, false)])
    );
    expect(walked.settledList).toBeNull();
  });
});

describe('proof 5: a list that changes while it is walked proves nothing', () => {
  it('is unknown, not "no", when a row shows up mid-walk and shifts the pages', async () => {
    // Out of the contract on purpose: the row stays hidden for longer than the
    // whole polling budget, so it appears while the cursor is being followed.
    const h = harness({ maxPolls: 2 });
    await setupScenario(h.ctx);
    const main = h.state.mainWalletId ?? '';
    h.mock.sandbox.ledger.fund({ wallet_id: main, amount: 1000 });
    h.mock.sandbox.options.listLagReads = 4;
    h.mock.sandbox.ledger.fund({ wallet_id: main, amount: 1000 });
    const result = await runProof5(h.ctx);
    expect(answer(result, 'transaction_list_cursor_advances')).toBe('unknown');
    expect(result.status).toBe('inconclusive');
  });
});

describe('proof 5: a cursor that rotates over the same rows is not progress', () => {
  it('is no when every follow-up page repeats the same rows under a new cursor', async () => {
    const h = harness({
      mock: { accruedEdgeCount: 5, pagingMode: 'rotating_cursor_same_rows' },
    });
    await setupScenario(h.ctx);
    for (let i = 0; i < 4; i += 1) {
      h.mock.sandbox.ledger.fund({
        wallet_id: h.state.mainWalletId,
        amount: 1000,
      });
    }
    const result = await runProof5(h.ctx);
    expect(answer(result, 'accrual_cursor_advances')).toBe('no');
    expect(answer(result, 'transaction_list_cursor_advances')).toBe('no');
  });

  it('is no when the pager keeps returning the same next cursor', async () => {
    const h = harness({
      mock: { accruedEdgeCount: 5, pagingMode: 'stuck_cursor' },
    });
    await setupScenario(h.ctx);
    const result = await runProof5(h.ctx);
    expect(answer(result, 'accrual_cursor_advances')).toBe('no');
  });
});

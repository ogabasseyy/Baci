import { afterEach, describe, expect, it } from 'vitest';
import { runProof5 } from './proof-5-interest';
import type { CallResult, ProviderApi } from './provider-ops';
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

type Query = Parameters<ProviderApi['transactions']>[0];
interface Row {
  id: string;
  category: string;
}

const listCall = (data: unknown): CallResult => ({
  ok: true,
  httpStatus: 200,
  data,
  envelope: null,
  message: null,
  declined: false,
  errorCode: null,
  typedAccepted: true,
});

/** A provider whose history has `total` rows, paged by offset cursor. */
function history(
  total: number,
  options: { interestAt?: number; omitPageInfo?: boolean } = {}
) {
  const rows: Row[] = Array.from({ length: total }, (_, index) => ({
    id: `t${index}`,
    category: index === options.interestAt ? 'interest-payout' : 'p2p',
  }));
  return async (query: Query): Promise<CallResult> => {
    const start = Number(query.cursor ?? 0);
    const end = Math.min(total, start + Number(query.limit ?? 20));
    const hasNextPage = end < total;
    return listCall({
      edges: rows.slice(start, end),
      ...(options.omitPageInfo
        ? {}
        : {
            pageInfo: {
              hasNextPage,
              endCursor: hasNextPage ? String(end) : null,
            },
          }),
    });
  };
}

async function setup(maxPolls = 2) {
  const h = harness({ maxPolls });
  await setupScenario(h.ctx);
  return h;
}

describe('proof 5: a row that appears after the walk invalidates the snapshot', () => {
  it('is unknown, not "no", when an interest row shows up in the post-walk read', async () => {
    const h = await setup(2);
    const quiet = history(0);
    const original = h.api.transactions.bind(h.api);
    let snapshots = 0;
    h.api.transactions = async (query) => {
      if (query.limit !== '100') return original(query);
      snapshots += 1;
      // Reads 1..maxPolls+1 are the initial snapshot and the polling window;
      // the next one is the check made after the cursor walk.
      return snapshots <= h.ctx.maxPolls + 1
        ? quiet(query)
        : listCall({
            edges: [{ id: 'late', category: 'interest-payout' }],
            pageInfo: { hasNextPage: false, endCursor: null },
          });
    };
    const result = await runProof5(h.ctx);
    expect(answer(result, 'transaction_list_has_interest_rows')).toBe(
      'unknown'
    );
    expect(result.values.transaction_list_interest_rows).toBeNull();
    expect(result.status).toBe('inconclusive');
  });

  it('does not publish "no accrual records" when a record appears after the walk', async () => {
    const h = await setup(2);
    const original = h.api.accrued.bind(h.api);
    let snapshots = 0;
    h.api.accrued = async (walletId, query = {}) => {
      if (query.limit !== '100') return original(walletId, query);
      snapshots += 1;
      return snapshots <= h.ctx.maxPolls + 1
        ? original(walletId, query)
        : listCall({
            edges: [{ id: 'late-accrual' }],
            pageInfo: { hasNextPage: false, endCursor: null },
          });
    };
    const result = await runProof5(h.ctx);
    expect(answer(result, 'accrual_records_observed')).toBe('unknown');
  });
});

describe('proof 5: absence needs the whole history, not just its first page', () => {
  it('is unknown, not "no", when the sole interest row is on page 2 of 101', async () => {
    const h = await setup();
    h.api.transactions = history(101, { interestAt: 100 });
    const result = await runProof5(h.ctx);
    expect(answer(result, 'transaction_list_has_interest_rows')).toBe(
      'unknown'
    );
    expect(result.values.transaction_list_history_complete).toBe(false);
    expect(result.status).toBe('inconclusive');
  });

  it('is unknown when a full page carries no pagination info to say it ended', async () => {
    const h = await setup();
    h.api.transactions = history(100, { omitPageInfo: true });
    const result = await runProof5(h.ctx);
    expect(answer(result, 'transaction_list_has_interest_rows')).toBe(
      'unknown'
    );
  });

  it('is still yes when an interest row is on the inspected page of a longer history', async () => {
    const h = await setup();
    h.api.transactions = history(101, { interestAt: 3 });
    const result = await runProof5(h.ctx);
    expect(answer(result, 'transaction_list_has_interest_rows')).toBe('yes');
  });

  it('is still no for a history that exactly fills the page and says it ended', async () => {
    const h = await setup();
    h.api.transactions = history(100);
    const result = await runProof5(h.ctx);
    expect(answer(result, 'transaction_list_has_interest_rows')).toBe('no');
    expect(result.values.transaction_list_history_complete).toBe(true);
  });
});

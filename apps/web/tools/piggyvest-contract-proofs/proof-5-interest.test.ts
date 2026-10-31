import { afterEach, describe, expect, it } from 'vitest';
import { countInterestRows, runProof5 } from './proof-5-interest';
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
const posts = (h: ReturnType<typeof makeHarness>) =>
  h.mock.calls.filter((c) => c.method === 'POST').length;

async function run(options: Parameters<typeof makeHarness>[0] = {}) {
  const h = harness(options);
  await setupScenario(h.ctx);
  const postsBefore = posts(h);
  const result = await runProof5(h.ctx);
  return { h, result, postsBefore };
}

describe('proof 5: interest visibility (development evidence)', () => {
  it('records absence honestly at 0% sandbox rates, with page shapes but no edge shape', async () => {
    const { h, result } = await run();
    expect(result.status).toBe('observed');
    expect(result.values.accrual_edges_default_window).toBe(0);
    expect(answer(result, 'accrual_records_observed')).toBe('no');
    expect(answer(result, 'accrual_edge_shape_observed')).toBe('no');
    expect(result.values.accrual_page_info_fields).toBe(
      'endCursor,hasNextPage,previousCursor'
    );
    expect(result.values.interest_rate_nonzero_on_any_wallet).toBe(false);
    expect(answer(result, 'transaction_list_has_interest_rows')).toBe('no');
    expect(answer(result, 'existing_accrual_schema_accepts_response')).toBe(
      'yes'
    );
    expect(result.notes.join(' ')).toMatch(/release check/i);
    expect(h.redactor.leaks(JSON.stringify(result))).toEqual([]);
  });

  it('records the limit ceiling for both accrual reads and the transaction list', async () => {
    const { result } = await run();
    expect(result.values.accrual_limit_101_http_status).toBe(400);
    expect(result.values.transaction_list_limit_101_http_status).toBe(400);
  });

  it('is read-only: it sends no POST of its own, even in mutation mode', async () => {
    const { h, postsBefore } = await run();
    expect(posts(h)).toBe(postsBefore);
  });

  it('observes edge fields and cursor pagination when accrual records exist', async () => {
    const { result } = await run({ mock: { accruedEdgeCount: 5 } });
    expect(answer(result, 'accrual_records_observed')).toBe('yes');
    expect(answer(result, 'accrual_edge_shape_observed')).toBe('yes');
    expect(answer(result, 'accrual_cursor_advances')).toBe('yes');
    expect(result.values.accrual_pages_walked).toBe(3);
    const edge = result.shapes.find(
      (s) => s.name === 'GET accrued interest (edge)'
    );
    expect(edge?.fields.map((f) => f.path)).toEqual(
      expect.arrayContaining([
        'percentage',
        'interest_type',
        'differential_wallet_id',
      ])
    );
  });

  it('walks the transaction list by cursor and reports whether it advances', async () => {
    const h = harness();
    await setupScenario(h.ctx);
    for (let i = 0; i < 4; i += 1) {
      h.mock.sandbox.ledger.fund({
        wallet_id: h.state.mainWalletId,
        amount: 1000,
      });
    }
    const result = await runProof5(h.ctx);
    expect(answer(result, 'transaction_list_cursor_advances')).toBe('yes');
    expect(result.values.transaction_list_pages_walked).toBe(3);
  });

  it('works in read-only mode', async () => {
    const seeded = harness();
    await setupScenario(seeded.ctx);
    const { customers, wallets } = seeded.mock.sandbox;
    seeded.dispose();
    const h = harness({ mode: 'live-readonly' });
    h.mock.sandbox.customers = customers;
    h.mock.sandbox.wallets = wallets;
    await setupScenario(h.ctx);
    const result = await runProof5(h.ctx);
    expect(result.status).toBe('observed');
    expect(posts(h)).toBe(0);
  });

  it('is inconclusive without QA wallets', async () => {
    const h = harness({ mode: 'live-readonly' });
    await setupScenario(h.ctx);
    expect((await runProof5(h.ctx)).status).toBe('inconclusive');
  });
});

describe('countInterestRows', () => {
  it('counts rows whose category mentions interest', () => {
    expect(
      countInterestRows([
        { category: 'interest-payout' },
        { category: 'p2p' },
        { category: 'Interest_Accrued' },
        null,
      ])
    ).toBe(2);
  });
});

describe('proof 5: an unreadable endpoint is not an empty history', () => {
  async function runWithEverything503() {
    const h = harness();
    await setupScenario(h.ctx);
    h.mock.sandbox.options.serverErrorPaths = ['/api/v1/'];
    const result = await runProof5(h.ctx);
    return { h, result };
  }

  it('reports unknown, not "no records", when every read returns 503', async () => {
    const { result } = await runWithEverything503();
    expect(result.status).toBe('inconclusive');
    for (const id of [
      'accrual_records_observed',
      'accrual_edge_shape_observed',
      'accrual_cursor_advances',
      'existing_accrual_schema_accepts_response',
      'transaction_list_cursor_advances',
      'transaction_list_has_interest_rows',
    ]) {
      expect(answer(result, id), id).toBe('unknown');
    }
    expect(result.values.accrual_edges_default_window).toBeNull();
    expect(result.values.accrual_pages_walked).toBe(0);
    expect(result.values.interest_rate_nonzero_on_any_wallet).toBeNull();
    expect(result.values.accrual_limit_101_http_status).toBe(503);
  });

  it('reports unknown when only the accrual endpoint is down', async () => {
    const h = harness();
    await setupScenario(h.ctx);
    h.mock.sandbox.options.serverErrorPaths = ['/interests/accrued'];
    const result = await runProof5(h.ctx);
    expect(answer(result, 'accrual_records_observed')).toBe('unknown');
    expect(answer(result, 'transaction_list_has_interest_rows')).toBe('no');
    expect(result.status).toBe('inconclusive');
  });

  it('reports unknown when a 200 carries a list container it does not recognise', async () => {
    const h = harness();
    await setupScenario(h.ctx);
    const original = h.api.accrued.bind(h.api);
    h.api.accrued = async (walletId, query) => ({
      ...(await original(walletId, query)),
      ok: true,
      data: { rows: [] },
    });
    const result = await runProof5(h.ctx);
    expect(answer(result, 'accrual_records_observed')).toBe('unknown');
    expect(result.status).toBe('inconclusive');
  });
});

describe('proof 5: a cursor "advances" only after the next page was read and shows progress', () => {
  async function withRows(options: Parameters<typeof makeHarness>[0] = {}) {
    const h = harness({
      ...options,
      mock: { accruedEdgeCount: 5, ...options?.mock },
    });
    await setupScenario(h.ctx);
    for (let i = 0; i < 4; i += 1) {
      h.mock.sandbox.ledger.fund({
        wallet_id: h.state.mainWalletId,
        amount: 1000,
      });
    }
    return h;
  }

  it('is yes when following the cursor reads a different page', async () => {
    const h = await withRows();
    const result = await runProof5(h.ctx);
    expect(answer(result, 'accrual_cursor_advances')).toBe('yes');
    expect(answer(result, 'transaction_list_cursor_advances')).toBe('yes');
  });

  it('is unknown, not yes, when following the cursor fails', async () => {
    const h = await withRows();
    h.mock.sandbox.options.serverErrorPaths = ['cursor='];
    const result = await runProof5(h.ctx);
    expect(answer(result, 'accrual_cursor_advances')).toBe('unknown');
    expect(answer(result, 'transaction_list_cursor_advances')).toBe('unknown');
  });

  it('is no when the next page is identical to the previous one', async () => {
    const h = await withRows();
    const original = h.api.accrued.bind(h.api);
    // Every cursor request is answered with the FIRST page again.
    h.api.accrued = async (walletId, query = {}) => {
      const { cursor: _ignored, ...withoutCursor } = query;
      return original(walletId, withoutCursor);
    };
    const result = await runProof5(h.ctx);
    expect(answer(result, 'accrual_cursor_advances')).toBe('no');
  });
});

describe('proof 5: counts are null, not zero, when the read behind them failed', () => {
  it('nulls the differential and transaction-list counts when those reads are unusable', async () => {
    const h = harness();
    await setupScenario(h.ctx);
    h.mock.sandbox.options.serverErrorPaths = ['/api/v1/'];
    const result = await runProof5(h.ctx);
    expect(result.values.accrual_differential_edges).toBeNull();
    expect(result.values.transaction_list_rows_read).toBeNull();
    expect(result.values.transaction_list_interest_rows).toBeNull();
  });
});

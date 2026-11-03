import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryJournal } from './mutation-journal';
import { runProof3, selectDepositRow } from './proof-3-goal-deposit';
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
  const result = await runProof3(h.ctx);
  return { h, result };
}

describe('proof 3: bank deposit into a goal sub-wallet', () => {
  it('credits the goal wallet (not main), names it in the transaction records, and records the fee', async () => {
    const { h, result } = await run();
    expect(result.status).toBe('observed');
    expect(answer(result, 'credited_to_goal_wallet')).toBe('yes');
    expect(answer(result, 'main_wallet_unchanged')).toBe('yes');
    expect(answer(result, 'transaction_list_names_goal_wallet')).toBe('yes');
    expect(answer(result, 'main_wallet_list_excludes_deposit_row')).toBe('yes');
    expect(answer(result, 'single_transaction_names_destination_wallet')).toBe(
      'yes'
    );
    expect(answer(result, 'goal_wallet_has_own_virtual_account')).toBe('yes');
    expect(answer(result, 'goal_account_differs_from_main')).toBe('yes');
    expect(result.values.deposit_credit_relation).toBe('net_of_fee');
    expect(result.values.deposit_fee_kobo_in_record).toBe(5_000);
    expect(result.values.deposit_row_category).toBe('inflow_transaction');
    expect(h.redactor.leaks(JSON.stringify(result))).toEqual([]);
  });

  it('cannot observe the webhook and says so instead of guessing', async () => {
    const { result } = await run();
    const webhook = result.findings.find(
      (f) => f.id === 'webhook_names_goal_wallet'
    );
    expect(webhook?.answer).toBe('unknown');
    expect(webhook?.detail).toMatch(/no receiver/i);
  });

  it('reports a gross credit when the fee is not taken from the wallet', async () => {
    const { result } = await run({ mock: { depositFeeBorneByWallet: false } });
    expect(result.values.deposit_credit_relation).toBe('gross');
  });

  it('does not call a lagging sandbox "no": the credit is unknown and the proof inconclusive', async () => {
    const { result } = await run({ mock: { fundingSettles: false } });
    expect(answer(result, 'credited_to_goal_wallet')).toBe('unknown');
    expect(result.status).toBe('inconclusive');
  });

  it('read-only mode still compares the two virtual accounts but sends no POST', async () => {
    const seeded = harness();
    await setupScenario(seeded.ctx);
    const { customers, wallets } = seeded.mock.sandbox;
    seeded.dispose();
    const h = harness({ mode: 'live-readonly' });
    h.mock.sandbox.customers = customers;
    h.mock.sandbox.wallets = wallets;
    await setupScenario(h.ctx);
    const result = await runProof3(h.ctx);
    expect(posts(h)).toBe(0);
    expect(answer(result, 'goal_account_differs_from_main')).toBe('yes');
    expect(answer(result, 'credited_to_goal_wallet')).toBe('unknown');
    expect(result.status).toBe('inconclusive');
  });

  it('never resends the funding call on a re-run', async () => {
    const journal = createMemoryJournal();
    const first = await run({ journal });
    const { customers, wallets } = first.h.mock.sandbox;
    first.h.dispose();
    const h = harness({ journal, runId: 'run2' });
    h.mock.sandbox.customers = customers;
    h.mock.sandbox.wallets = wallets;
    await setupScenario(h.ctx);
    const result = await runProof3(h.ctx);
    expect(posts(h)).toBe(0);
    expect(result.notes.join(' ')).toMatch(/--new-attempt/);
  });
});

describe('selectDepositRow with earlier credits', () => {
  const credit = (amount: number, id: string) => ({
    id,
    type: 'credit',
    amount,
  });
  it('never selects a credit that existed before this deposit, even with the same amount', () => {
    const rows = [credit(200000, 'old-attempt-row')];
    expect(
      selectDepositRow(rows, 200000, 195000, new Set(['old-attempt-row']))
    ).toBeUndefined();
    expect(
      selectDepositRow(
        [credit(200000, 'new-row'), ...rows],
        200000,
        195000,
        new Set(['old-attempt-row'])
      )
    ).toMatchObject({ id: 'new-row' });
  });
});

describe('selectDepositRow', () => {
  const credit = (amount: number, id: string) => ({
    id,
    type: 'credit',
    amount,
  });
  it('matches the gross amount or the measured credit, never an unrelated credit', () => {
    expect(
      selectDepositRow(
        [credit(100000, 'a'), credit(200000, 'b')],
        200000,
        195000
      )
    ).toMatchObject({ id: 'b' });
    expect(
      selectDepositRow(
        [credit(100000, 'a'), credit(195000, 'c')],
        200000,
        195000
      )
    ).toMatchObject({ id: 'c' });
    expect(
      selectDepositRow([credit(100000, 'a')], 200000, 195000)
    ).toBeUndefined();
    expect(
      selectDepositRow([credit(100000, 'a')], 200000, null)
    ).toBeUndefined();
    expect(selectDepositRow([], 200000, 195000)).toBeUndefined();
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryJournal } from './mutation-journal';
import { runProof4 } from './proof-4-withdrawal-counter';
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
  const result = await runProof4(h.ctx);
  return { h, result };
}
const deltaKeys = (result: ProofResult, prefix: string) =>
  Object.keys(result.values).filter((key) => key.startsWith(prefix));

describe('proof 4: withdrawal counter', () => {
  it('shows wallet-to-wallet leaving the counter alone and a bank outflow raising it on the source wallet only', async () => {
    const { h, result } = await run();
    expect(result.status).toBe('observed');
    expect(answer(result, 'w2w_changes_counter')).toBe('no');
    expect(answer(result, 'bank_outflow_changes_counter')).toBe('yes');
    expect(result.values.counter_scope).toBe('per_wallet');
    expect(deltaKeys(result, 'bank_delta_')).toHaveLength(2);
    expect(result.values.bank_delta_main_W1).toBe(1);
    expect(h.redactor.leaks(JSON.stringify(result))).toEqual([]);
  });

  it('recognises a per-customer counter when every wallet moves', async () => {
    const { result } = await run({ mock: { counterScope: 'customer' } });
    expect(result.values.counter_scope).toBe('per_customer');
  });

  it('flags the dangerous outcome: wallet-to-wallet counted as a withdrawal', async () => {
    const { result } = await run({ mock: { w2wIncrementsCounter: true } });
    expect(answer(result, 'w2w_changes_counter')).toBe('yes');
  });

  it('waits for a late counter update before answering a wallet transfer "no"', async () => {
    const { result } = await run({
      mock: { w2wIncrementsCounter: true, counterLagReads: 2 },
    });
    expect(answer(result, 'w2w_changes_counter')).toBe('yes');
  });

  it('keeps a late wallet-transfer increment out of the bank-outflow delta', async () => {
    const { result } = await run({
      mock: { w2wIncrementsCounter: true, counterLagReads: 2 },
    });
    expect(result.values.bank_delta_main_W1).toBe(1);
  });

  it('records a bank outflow that does not touch the counter', async () => {
    const { result } = await run({ mock: { bankIncrementsCounter: false } });
    expect(answer(result, 'bank_outflow_changes_counter')).toBe('no');
    expect(result.values.counter_scope).toBe('unknown');
  });

  it('skips only the bank step when no sandbox destination is configured', async () => {
    const { h, result } = await run({ bank: null });
    expect(answer(result, 'w2w_changes_counter')).toBe('no');
    expect(answer(result, 'bank_outflow_changes_counter')).toBe('unknown');
    expect(result.status).toBe('inconclusive');
    expect(
      h.mock.calls.filter((c) => c.pathname === '/api/v1/transfer/bank')
    ).toHaveLength(0);
  });

  it('never calls an unsettled transfer "no change"', async () => {
    const { result } = await run({ mock: { tsqPendingPolls: 100 } });
    expect(answer(result, 'w2w_changes_counter')).toBe('unknown');
    expect(answer(result, 'bank_outflow_changes_counter')).toBe('unknown');
  });

  it('read-only mode only records the baseline counters and sends no POST', async () => {
    const seeded = harness();
    await setupScenario(seeded.ctx);
    const { customers, wallets } = seeded.mock.sandbox;
    seeded.dispose();
    const h = harness({ mode: 'live-readonly' });
    h.mock.sandbox.customers = customers;
    h.mock.sandbox.wallets = wallets;
    await setupScenario(h.ctx);
    const result = await runProof4(h.ctx);
    expect(posts(h)).toBe(0);
    expect(deltaKeys(result, 'baseline_count_')).toHaveLength(2);
    expect(answer(result, 'bank_outflow_changes_counter')).toBe('unknown');
    expect(result.status).toBe('inconclusive');
  });

  it('does not resend either transfer on a re-run', async () => {
    const journal = createMemoryJournal();
    const first = await run({ journal });
    const { customers, wallets } = first.h.mock.sandbox;
    first.h.dispose();
    const h = harness({ journal, runId: 'run2' });
    h.mock.sandbox.customers = customers;
    h.mock.sandbox.wallets = wallets;
    await setupScenario(h.ctx);
    const result = await runProof4(h.ctx);
    expect(posts(h)).toBe(0);
    expect(result.notes.join(' ')).toMatch(/--new-attempt/);
  });

  it('keeps the destination bank account out of the evidence', async () => {
    const { result } = await run();
    expect(JSON.stringify(result)).not.toContain('0123456789');
  });
});

describe('proof 4: the configured polling budget decides "no change"', () => {
  async function runLagged(maxPolls: number) {
    return run({
      maxPolls,
      mock: { w2wIncrementsCounter: true, counterLagReads: 5 },
    });
  }

  it('reports both increments when counters lag 5 reads and the budget is 15', async () => {
    const { result } = await runLagged(15);
    expect(answer(result, 'w2w_changes_counter')).toBe('yes');
    expect(answer(result, 'bank_outflow_changes_counter')).toBe('yes');
  });

  it('starts the bank measurement only after the wallet-transfer counter settled', async () => {
    const { result } = await runLagged(15);
    expect(result.values.w2w_delta_main_W1).toBe(1);
    expect(result.values.bank_delta_main_W1).toBe(1);
  });

  it('records the window a negative answer was measured over', async () => {
    const { result } = await run({ maxPolls: 9 });
    expect(result.values.counter_settle_polls).toBe(9);
  });
});

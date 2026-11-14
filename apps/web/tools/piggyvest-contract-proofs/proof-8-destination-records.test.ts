import { afterEach, describe, expect, it } from 'vitest';
import { admitHouseWallet } from './house-wallet';
import { createMemoryJournal } from './mutation-journal';
import { runProof8 } from './proof-8-destination-records';
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
const transfers = (h: ReturnType<typeof harness>) =>
  h.mock.calls.filter(
    (c) => c.method === 'POST' && c.pathname === '/api/v1/transfer/wallet'
  ).length;
const LEGS = ['collection_to_main', 'main_to_goal', 'goal_to_main'] as const;

/** A QA customer whose goal and the house wallet both hold enough to send. */
async function ready(
  options: Parameters<typeof makeHarness>[0] = {},
  fundHouse = true
) {
  const h = harness(options);
  await setupScenario(h.ctx);
  const { ledger, businessWalletId } = h.mock.sandbox;
  ledger.fund({ wallet_id: h.state.goalWalletId, amount: 300_000 });
  if (fundHouse) ledger.fund({ wallet_id: businessWalletId, amount: 300_000 });
  return h;
}

describe('proof 8: destination-side records', () => {
  it('records, for every leg, the destination row, our reference, the source wallet and the shared ids', async () => {
    const h = await ready({ mock: { tsqShape: 'rich' } });
    const result = await runProof8(h.ctx);
    expect(transfers(h)).toBe(3);
    expect(result.status).toBe('observed');
    for (const leg of LEGS) {
      expect(result.values[`${leg}_terminal`]).toBe('success');
      expect(answer(result, `${leg}_destination_row_listed`)).toBe('yes');
      expect(
        answer(result, `${leg}_destination_row_carries_our_reference`)
      ).toBe('yes');
      // The mock books the credit under its own row id ...
      expect(answer(result, `${leg}_destination_row_id_is_source_tsq_id`)).toBe(
        'no'
      );
      // ... but the destination side still resolves the TSQ id.
      expect(answer(result, `${leg}_destination_resolves_source_tsq_id`)).toBe(
        'yes'
      );
      expect(
        answer(result, `${leg}_destination_record_names_source_wallet`)
      ).toBe('yes');
      expect(result.values[`${leg}_destination_row_matched_by`]).toBe(
        'reference'
      );
      expect(result.values[`${leg}_destination_row_type`]).toBe('credit');
    }
    expect(answer(result, 'destination_events')).toBe('unknown');
    expect(h.redactor.leaks(JSON.stringify(result))).toEqual([]);
  });

  it('records a TSQ that names no id as not observable rather than guessing', async () => {
    const h = await ready();
    const result = await runProof8(h.ctx);
    expect(result.status).toBe('observed');
    const finding = result.findings.find(
      (f) => f.id === 'main_to_goal_destination_row_id_is_source_tsq_id'
    );
    expect(finding?.answer).toBe('unknown');
    expect(finding?.detail).toMatch(/names no id/);
  });

  it('runs the QA legs but not the collection leg when no house wallet is admitted', async () => {
    const h = await ready({ businessWalletId: null });
    const result = await runProof8(h.ctx);
    expect(transfers(h)).toBe(2);
    expect(result.status).toBe('inconclusive');
    expect(result.reason).toMatch(/collection_to_main/);
    expect(answer(result, 'collection_to_main_destination_row_listed')).toBe(
      'unknown'
    );
    expect(answer(result, 'goal_to_main_destination_row_listed')).toBe('yes');
  });

  it('sends nothing from a source that holds less than the transfer amount', async () => {
    const h = await ready({}, false);
    await admitHouseWallet(h.ctx);
    const result = await runProof8(h.ctx);
    expect(transfers(h)).toBe(2);
    expect(result.reason).toMatch(/less than the transfer amount/);
  });

  it('is inconclusive when the destination row is never listed within the budget', async () => {
    const h = await ready({ mock: { listLagReads: 50 } });
    const result = await runProof8(h.ctx);
    expect(answer(result, 'main_to_goal_destination_row_listed')).toBe(
      'unknown'
    );
    expect(result.status).toBe('inconclusive');
  });

  it('never re-sends a leg on a re-run, and sends nothing in read-only mode', async () => {
    const journal = createMemoryJournal();
    const first = await ready({ journal });
    await runProof8(first.ctx);
    const sandbox = first.mock.sandbox;
    first.dispose();
    const h = harness({ journal });
    h.mock.sandbox.adopt(sandbox);
    await setupScenario(h.ctx);
    const result = await runProof8(h.ctx);
    expect(transfers(h)).toBe(0);
    expect(result.status).toBe('inconclusive');
    h.dispose();

    const readonly = harness({ mode: 'live-readonly' });
    await setupScenario(readonly.ctx);
    expect((await runProof8(readonly.ctx)).status).toBe('inconclusive');
    expect(transfers(readonly)).toBe(0);
  });
});

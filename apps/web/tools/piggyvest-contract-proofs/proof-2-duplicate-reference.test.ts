import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryJournal } from './mutation-journal';
import { runDuplicateReference } from './proof-2-duplicate-reference';
import { runProof2 } from './proof-2-tsq';
import { ProofBuilder } from './proof-builder';
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
const transferPosts = (h: ReturnType<typeof harness>) =>
  h.mock.calls.filter(
    (call) =>
      call.method === 'POST' && call.pathname === '/api/v1/transfer/wallet'
  ).length;

async function duplicate(h: ReturnType<typeof harness>) {
  const b = new ProofBuilder('p2', 'TSQ');
  await runDuplicateReference(h.ctx, b);
  return b.build(h.ctx);
}
async function afterProof2(options: Parameters<typeof makeHarness>[0] = {}) {
  const h = harness(options);
  await setupScenario(h.ctx);
  await runProof2(h.ctx);
  return h;
}

describe('proof 2: duplicate-reference re-send', () => {
  it('records a refused repeat with no second debit and no second record', async () => {
    const h = await afterProof2();
    const before = transferPosts(h);
    const result = await duplicate(h);
    expect(transferPosts(h)).toBe(before + 1);
    expect(result.status).toBe('observed');
    expect(answer(result, 'duplicate_reference_rejected')).toBe('yes');
    expect(answer(result, 'duplicate_reference_moves_money_again')).toBe('no');
    expect(answer(result, 'duplicate_reference_second_record')).toBe('no');
    expect(result.values).toMatchObject({
      duplicate_http_status: 400,
      duplicate_outcome: 'rejected',
      duplicate_message: 'Duplicate reference',
      duplicate_source_delta_kobo: 0,
      rows_with_reference_before: 1,
      rows_with_reference_after: 1,
      tsq_after_duplicate_status: 'success',
    });
    expect(h.redactor.leaks(JSON.stringify(result))).toEqual([]);
  });

  it('records a provider that books the repeat as a second transfer', async () => {
    const h = await afterProof2({ mock: { duplicateReference: 'accept' } });
    const result = await duplicate(h);
    expect(answer(result, 'duplicate_reference_rejected')).toBe('no');
    expect(answer(result, 'duplicate_reference_moves_money_again')).toBe('yes');
    expect(answer(result, 'duplicate_reference_second_record')).toBe('yes');
    expect(result.values.duplicate_source_delta_kobo).toBe(-100_000);
    expect(result.values.rows_with_reference_after).toBe(2);
  });

  it('never re-sends the duplicate on a re-run', async () => {
    const journal = createMemoryJournal();
    const first = await afterProof2({ journal });
    await duplicate(first);
    const sandbox = first.mock.sandbox;
    first.dispose();
    const h = harness({ journal });
    h.mock.sandbox.adopt(sandbox);
    await setupScenario(h.ctx);
    // The journaled proof 2 transfer is known again, but nothing is re-sent.
    h.state.walletTransfer = {
      kind: 'wallet',
      reference: journal.entries()[journal.entries().length - 2]?.reference,
      amountKobo: 100_000,
      terminal: 'success',
      sourceDeltaKobo: null,
      destinationDeltaKobo: null,
      feeFromRecordKobo: null,
      feeFieldPresent: null,
    };
    const before = transferPosts(h);
    const result = await duplicate(h);
    expect(transferPosts(h)).toBe(before);
    expect(result.status).toBe('inconclusive');
    expect(answer(result, 'duplicate_reference_rejected')).toBe('unknown');
  });

  it('sends nothing without a settled proof 2 transfer, or in read-only mode', async () => {
    const h = harness();
    await setupScenario(h.ctx);
    const result = await duplicate(h);
    expect(transferPosts(h)).toBe(0);
    expect(result.status).toBe('inconclusive');
    expect(result.reason).toMatch(/no settled proof 2 transfer/);
    h.dispose();

    const unsettled = await afterProof2({ mock: { tsqPendingPolls: 50 } });
    const before = transferPosts(unsettled);
    expect((await duplicate(unsettled)).status).toBe('inconclusive');
    expect(transferPosts(unsettled)).toBe(before);
  });
});

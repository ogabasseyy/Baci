import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryJournal } from './mutation-journal';
import { runDuplicateReference } from './proof-2-duplicate-reference';
import { runProof2 } from './proof-2-tsq';
import { ProofBuilder } from './proof-builder';
import { withExtension } from './proof-extension';
import { setupScenario } from './scenario';
import { makeHarness } from './test-harness.test-support';
import type { ProofResult } from './types';

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
const answer = (result: ProofResult, id: string) =>
  result.findings.find((f) => f.id === id)?.answer;
const transferPosts = (h: ReturnType<typeof harness>) =>
  h.mock.calls.filter(
    (call) =>
      call.method === 'POST' && call.pathname === '/api/v1/transfer/wallet'
  ).length;

/** Re-hides proof 2's transfer row for the next N list reads (late indexing). */
function hideOriginalRow(h: ReturnType<typeof harness>, reads: number): void {
  const ledger = h.mock.sandbox.ledger as unknown as {
    txns: { reference: string | null; hiddenReads: number }[];
  };
  for (const txn of ledger.txns)
    if (txn.reference === h.state.walletTransfer?.reference)
      txn.hiddenReads = reads;
}

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
      sendAccepted: true,
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

  it('never re-sends a reference whose first send was not journaled accepted, and the run carries on', async () => {
    const h = harness();
    await setupScenario(h.ctx);
    // The provider books proof 2's transfer but the reply is lost (502).
    const ledger = h.mock.sandbox.ledger;
    const book = ledger.transfer.bind(ledger);
    vi.spyOn(ledger, 'transfer').mockImplementationOnce((kind, body) => {
      book(kind, body);
      return { status: 502, body: { status: false, message: 'Bad Gateway' } };
    });
    const result = await withExtension(runProof2, runDuplicateReference)(h.ctx);
    const outcomes = h.journal
      .entries()
      .filter((entry) => entry.slot === 'p2/w2w' && entry.phase === 'outcome')
      .map((entry) => entry.outcome);
    expect(outcomes).toEqual(['indeterminate']);
    expect(h.state.walletTransfer?.terminal).toBe('success');
    expect(h.state.walletTransfer?.sendAccepted).toBe(false);
    expect(transferPosts(h)).toBe(1);
    expect(result.status).toBe('inconclusive');
    expect(result.reason).toMatch(/not journaled accepted/);
    for (const id of [
      'duplicate_reference_rejected',
      'duplicate_reference_moves_money_again',
      'duplicate_reference_second_record',
    ])
      expect(answer(result, id)).toBe('unknown');
    expect(
      h.journal
        .entries()
        .some((entry) => entry.slot === 'p2/duplicate_reference')
    ).toBe(false);
  });

  it('waits for the original row to be indexed before counting records', async () => {
    const h = await afterProof2();
    hideOriginalRow(h, 3);
    const result = await duplicate(h);
    expect(result.values.rows_with_reference_before).toBe(1);
    expect(result.values.rows_with_reference_after).toBe(1);
    expect(answer(result, 'duplicate_reference_rejected')).toBe('yes');
    expect(answer(result, 'duplicate_reference_second_record')).toBe('no');
  });

  it('answers the record question unknown when the original row never shows before the repeat', async () => {
    const h = await afterProof2();
    hideOriginalRow(h, 50);
    const result = await duplicate(h);
    // The late original must not be mistaken for a second record.
    expect(result.values.rows_with_reference_before).toBeNull();
    expect(answer(result, 'duplicate_reference_second_record')).toBe('unknown');
    expect(answer(result, 'duplicate_reference_rejected')).toBe('yes');
    expect(answer(result, 'duplicate_reference_moves_money_again')).toBe('no');
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

import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryJournal } from './mutation-journal';
import { runProof2 } from './proof-2-tsq';
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
  const result = await runProof2(h.ctx);
  return { h, result, postsBefore };
}

describe('proof 2: TSQ for a wallet-to-wallet transfer', () => {
  it('records what the documented TSQ shape does NOT show (wallets, fee, currency)', async () => {
    const { h, result } = await run();
    expect(result.status).toBe('observed');
    expect(answer(result, 'tsq_shows_amount')).toBe('yes');
    expect(answer(result, 'tsq_amount_matches_sent')).toBe('yes');
    expect(answer(result, 'tsq_shows_status')).toBe('yes');
    expect(answer(result, 'tsq_shows_currency')).toBe('no');
    expect(answer(result, 'tsq_shows_fee')).toBe('no');
    expect(answer(result, 'tsq_names_source_wallet')).toBe('no');
    expect(answer(result, 'tsq_names_destination_wallet')).toBe('no');
    expect(answer(result, 'existing_typed_tsq_schema_accepts_response')).toBe(
      'yes'
    );
    expect(result.values.status_sequence).toBe('pending > success');
    expect(result.values.terminal).toBe('success');
    expect(h.redactor.leaks(JSON.stringify(result))).toEqual([]);
  });

  it('falls back to the single-transaction record, which names both wallets', async () => {
    const { result } = await run();
    expect(answer(result, 'single_transaction_names_both_wallets')).toBe('yes');
    expect(answer(result, 'single_transaction_shows_fee')).toBe('yes');
  });

  it('detects a richer TSQ that names both wallets, and that the typed client rejects it', async () => {
    const { result } = await run({ mock: { tsqShape: 'rich' } });
    expect(answer(result, 'tsq_names_source_wallet')).toBe('yes');
    expect(answer(result, 'tsq_names_destination_wallet')).toBe('yes');
    expect(answer(result, 'tsq_shows_fee')).toBe('yes');
    expect(answer(result, 'tsq_shows_currency')).toBe('yes');
    expect(answer(result, 'existing_typed_tsq_schema_accepts_response')).toBe(
      'no'
    );
  });

  it('records the unknown-reference response exactly (status, message class, envelope shape)', async () => {
    const { result } = await run();
    expect(result.values.unknown_reference_http_status).toBe(404);
    expect(result.values.unknown_reference_message).toBe(
      'Transaction not found'
    );
    expect(answer(result, 'unknown_reference_is_404')).toBe('yes');
    const shape = result.shapes.find(
      (s) => s.name === 'GET TSQ (unknown reference)'
    );
    expect(shape?.fields).toEqual([
      { path: 'status', type: 'boolean(false)' },
      { path: 'message', type: 'string(text)' },
    ]);
  });

  it('observes a not-yet-indexed reference as 404 before it becomes pending', async () => {
    const { result } = await run({ mock: { tsqNotFoundPolls: 2 } });
    expect(result.values.status_immediately_after_submit).toBe('http_404');
    expect(String(result.values.status_sequence)).toBe(
      'http_404 > pending > success'
    );
  });

  it('read-only mode checks only the unknown reference and sends no POST', async () => {
    const seeded = harness();
    await setupScenario(seeded.ctx);
    const sandbox = seeded.mock.sandbox;
    seeded.dispose();
    const h = harness({ mode: 'live-readonly' });
    h.mock.sandbox.customers = sandbox.customers;
    h.mock.sandbox.wallets = sandbox.wallets;
    await setupScenario(h.ctx);
    const result = await runProof2(h.ctx);
    expect(posts(h)).toBe(0);
    expect(result.values.unknown_reference_http_status).toBe(404);
    expect(answer(result, 'tsq_names_source_wallet')).toBe('unknown');
    expect(result.status).toBe('inconclusive');
  });

  it('on a re-run does not resend the transfer but still queries its journaled reference', async () => {
    const journal = createMemoryJournal();
    const first = await run({ journal });
    const { customers, wallets } = first.h.mock.sandbox;
    first.h.dispose();
    const h = harness({ journal, runId: 'run2' });
    h.mock.sandbox.customers = customers;
    h.mock.sandbox.wallets = wallets;
    await setupScenario(h.ctx);
    const result = await runProof2(h.ctx);
    expect(posts(h)).toBe(0);
    expect(result.notes.join(' ')).toMatch(/--new-attempt/);
    expect(answer(result, 'tsq_shows_amount')).toBe('unknown');
  });

  it('is inconclusive when the provider declines the transfer, and keeps the decline message class', async () => {
    const { result } = await run({ mock: { fundingSettles: false } });
    expect(result.status).toBe('inconclusive');
    expect(result.values.transfer_outcome).toBe('rejected');
    expect(result.values.transfer_rejection_message).toBe('Insufficient funds');
  });

  it('stores a measured observation for the fee proof', async () => {
    const { h } = await run();
    expect(h.state.walletTransfer).toMatchObject({
      kind: 'wallet',
      terminal: 'success',
      amountKobo: 100_000,
      sourceDeltaKobo: -100_000,
      destinationDeltaKobo: 100_000,
    });
  });
});

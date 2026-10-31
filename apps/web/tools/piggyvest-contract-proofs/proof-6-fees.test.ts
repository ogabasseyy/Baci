import { afterEach, describe, expect, it } from 'vitest';
import { runProof2 } from './proof-2-tsq';
import { runProof3 } from './proof-3-goal-deposit';
import { runProof6 } from './proof-6-fees';
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

async function run(options: Parameters<typeof makeHarness>[0] = {}) {
  const h = harness(options);
  await setupScenario(h.ctx);
  await runProof2(h.ctx);
  await runProof3(h.ctx);
  const result = await runProof6(h.ctx);
  return { h, result };
}

describe('proof 6: fees', () => {
  it('derives who bears the deposit fee from the measured credit', async () => {
    const { h, result } = await run();
    expect(result.status).toBe('observed');
    expect(result.values.deposit_fee_kobo).toBe(5_000);
    expect(result.values.deposit_credit_relation).toBe('net_of_fee');
    expect(result.values.deposit_fee_borne_by).toBe(
      'wallet (credited net of fee)'
    );
    expect(answer(result, 'deposit_fee_field_present')).toBe('yes');
    expect(h.redactor.leaks(JSON.stringify(result))).toEqual([]);
  });

  it('shows a wallet transfer with no fee on the source when the fee is paid elsewhere', async () => {
    const { result } = await run({ mock: { transferFeeKobo: 100 } });
    expect(result.values.transfer_fee_kobo).toBe(100);
    expect(answer(result, 'transfer_source_debited_exactly_amount')).toBe(
      'yes'
    );
    expect(result.values.transfer_fee_payer).toBe(
      'not the source wallet (source debited exactly the amount)'
    );
  });

  it('reports no fee observed on a fee-free transfer', async () => {
    const { result } = await run();
    expect(result.values.transfer_fee_kobo).toBe(0);
    expect(result.values.transfer_fee_payer).toBe('none observed');
  });

  it('reads historical records for fee fields even without a mutation run', async () => {
    const seeded = await run();
    const { customers, wallets, ledger } = seeded.h.mock.sandbox;
    seeded.h.dispose();
    const h = harness({ mode: 'live-readonly' });
    h.mock.sandbox.customers = customers;
    h.mock.sandbox.wallets = wallets;
    // reuse the first run's transactions through its ledger-backed mock
    (h.mock.sandbox as unknown as { ledger: unknown }).ledger = ledger;
    await setupScenario(h.ctx);
    const result = await runProof6(h.ctx);
    expect(answer(result, 'deposit_fee_field_present')).toBe('unknown');
    expect(Number(result.values.historical_records_read)).toBeGreaterThan(0);
    expect(
      Number(result.values.historical_records_with_fee_field)
    ).toBeGreaterThan(0);
    expect(String(result.values.historical_fee_values_kobo)).toContain('5000');
  });

  it('is inconclusive when nothing was measured and nothing is on record', async () => {
    const h = harness({ mode: 'live-readonly' });
    await setupScenario(h.ctx);
    const result = await runProof6(h.ctx);
    expect(result.status).toBe('inconclusive');
  });
});

describe('proof 6: an unread record is not "no fee field"', () => {
  async function measured(
    options: Parameters<typeof makeHarness>[0] = {},
    singleDown = false
  ) {
    const h = harness(options);
    await setupScenario(h.ctx);
    if (singleDown)
      h.mock.sandbox.options.serverErrorPaths = ['/api/v1/transaction/01M2T'];
    await runProof2(h.ctx);
    await runProof3(h.ctx);
    return { h, result: await runProof6(h.ctx) };
  }

  it('answers unknown for both fee-field findings when the single records were unreadable', async () => {
    const { result } = await measured({}, true);
    expect(answer(result, 'deposit_fee_field_present')).toBe('unknown');
    expect(answer(result, 'transfer_fee_field_present')).toBe('unknown');
  });

  it('does not call the deposit credit "other" when the fee is unknown', async () => {
    const { result } = await measured({}, true);
    expect(result.values.deposit_credit_relation).toBe('unknown');
    expect(result.values.deposit_fee_borne_by).toBe('unknown');
  });

  it('does not claim "no fee" for the payer when the transfer fee was never read', async () => {
    const { result } = await measured({}, true);
    expect(result.values.transfer_fee_payer).toBe(
      'unknown (the fee was not read)'
    );
  });

  it('still reports a known zero fee as none observed', async () => {
    const { result } = await measured();
    expect(result.values.transfer_fee_payer).toBe('none observed');
    expect(answer(result, 'transfer_fee_field_present')).toBe('yes');
  });

  it('counts only successful object records in the history scan, and counts unreadable wallets', async () => {
    const h = harness();
    await setupScenario(h.ctx);
    const original = h.api.transaction.bind(h.api);
    h.api.transaction = async (id, walletId) => ({
      ...(await original(id, walletId)),
      ok: true,
      data: 'text',
    });
    const result = await runProof6(h.ctx);
    expect(result.values.historical_records_read).toBe(0);
    expect(result.values.historical_records_with_fee_field).toBe(0);

    h.mock.sandbox.options.serverErrorPaths = ['/api/v1/transaction?'];
    const noLists = await runProof6(h.ctx);
    expect(noLists.values.historical_wallets_unreadable).toBe(
      h.state.wallets.length
    );
  });
});

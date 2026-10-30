import { afterEach, describe, expect, it } from 'vitest';
import { runProof2 } from './proof-2-tsq';
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

describe('proof 2: unreadable, lagging or unsettled reads are never "no"', () => {
  async function prepared(options: Parameters<typeof makeHarness>[0] = {}) {
    const h = harness(options);
    await setupScenario(h.ctx);
    return h;
  }
  const failing = (status: number, extra: object = {}) => ({
    ok: false,
    httpStatus: status,
    data: undefined,
    envelope: null,
    message: null,
    declined: true,
    errorCode: 'PIGGYVEST_REQUEST_ERROR',
    typedAccepted: false,
    ...extra,
  });

  it('answers unknown, not "no", when the unknown-reference check gets a 503', async () => {
    const h = await prepared();
    h.mock.sandbox.options.serverErrorPaths = [
      '/transaction/verify?reference=pvbproof-unknown',
    ];
    const result = await runProof2(h.ctx);
    expect(result.values.unknown_reference_http_status).toBe(503);
    expect(answer(result, 'unknown_reference_is_404')).toBe('unknown');
  });

  it('still answers no for a definite non-404 client error', async () => {
    const h = await prepared();
    const original = h.api.verify.bind(h.api);
    let first = true;
    h.api.verify = async (reference, walletId) => {
      if (first) {
        first = false;
        return failing(400);
      }
      return original(reference, walletId);
    };
    const result = await runProof2(h.ctx);
    expect(answer(result, 'unknown_reference_is_404')).toBe('no');
  });

  it('polls balance readbacks within the budget when they lag the TSQ result', async () => {
    const h = await prepared({ maxPolls: 6 });
    h.mock.sandbox.options.balanceLagReads = 3;
    const result = await runProof2(h.ctx);
    expect(result.status).toBe('observed');
    expect(h.state.walletTransfer).toMatchObject({
      terminal: 'success',
      sourceDeltaKobo: -100_000,
      destinationDeltaKobo: 100_000,
    });
  });

  it('leaves the deltas unknown, not zero, when balances never settle in the budget', async () => {
    const h = await prepared({ maxPolls: 3 });
    h.mock.sandbox.options.balanceLagReads = 50;
    const result = await runProof2(h.ctx);
    expect(result.status).toBe('inconclusive');
    expect(h.state.walletTransfer).toMatchObject({
      terminal: 'success',
      sourceDeltaKobo: null,
      destinationDeltaKobo: null,
    });
  });

  it('proof 6 reports the transfer fee findings unknown after unsettled balances, never "no"', async () => {
    const h = await prepared({ maxPolls: 3 });
    h.mock.sandbox.options.balanceLagReads = 50;
    await runProof2(h.ctx);
    const fees = await runProof6(h.ctx);
    expect(
      answer(fees, 'transfer_source_debited_exactly_amount')
    ).toBeUndefined();
    expect(answer(fees, 'transfer_fee_field_present')).toBe('unknown');
  });

  it('reports every TSQ field finding unknown when the transfer never reached a settled TSQ result', async () => {
    const h = await prepared({ maxPolls: 3, mock: { tsqPendingPolls: 50 } });
    const result = await runProof2(h.ctx);
    for (const id of [
      'tsq_shows_amount',
      'tsq_shows_fee',
      'tsq_shows_currency',
      'tsq_names_source_wallet',
      'tsq_names_destination_wallet',
      'tsq_found_with_source_wallet_filter',
      'tsq_found_with_destination_wallet_filter',
    ]) {
      expect(answer(result, id), id).toBe('unknown');
    }
    expect(result.status).toBe('inconclusive');
  });

  it('answers unknown for a filtered lookup that hit a gateway error, and no only for a definite decline', async () => {
    const h = await prepared();
    const original = h.api.verify.bind(h.api);
    h.api.verify = async (reference, walletId) =>
      walletId === h.state.goalWalletId
        ? failing(503)
        : original(reference, walletId);
    const unknown = await runProof2(h.ctx);
    expect(answer(unknown, 'tsq_found_with_destination_wallet_filter')).toBe(
      'unknown'
    );
    expect(answer(unknown, 'tsq_found_with_source_wallet_filter')).toBe('yes');
    h.dispose();

    const declined = await prepared();
    const base = declined.api.verify.bind(declined.api);
    declined.api.verify = async (reference, walletId) =>
      walletId === declined.state.goalWalletId
        ? failing(404, { message: 'Transaction not found' })
        : base(reference, walletId);
    const result = await runProof2(declined.ctx);
    expect(answer(result, 'tsq_found_with_destination_wallet_filter')).toBe(
      'no'
    );
  });

  it('polls the list for the new row within the budget before using the single record', async () => {
    const h = await prepared({ maxPolls: 6 });
    h.mock.sandbox.options.listLagReads = 2;
    const result = await runProof2(h.ctx);
    expect(answer(result, 'single_transaction_names_both_wallets')).toBe('yes');
  });

  it('answers unknown when the list cannot be read or the single record is not an object', async () => {
    const down = await prepared();
    down.mock.sandbox.options.serverErrorPaths = [
      `/api/v1/transaction?wallet_id=${down.state.mainWalletId}`,
    ];
    const noList = await runProof2(down.ctx);
    expect(answer(noList, 'single_transaction_names_both_wallets')).toBe(
      'unknown'
    );
    expect(answer(noList, 'single_transaction_shows_fee')).toBe('unknown');
    down.dispose();

    const odd = await prepared();
    const original = odd.api.transaction.bind(odd.api);
    odd.api.transaction = async (id, walletId) => ({
      ...(await original(id, walletId)),
      ok: true,
      data: 'text',
    });
    const shaped = await runProof2(odd.ctx);
    expect(answer(shaped, 'single_transaction_names_both_wallets')).toBe(
      'unknown'
    );
    expect(answer(shaped, 'single_transaction_shows_fee')).toBe('unknown');
  });

  it('records fee-field presence only when records were read (absence needs both reads)', async () => {
    const both = await prepared();
    await runProof2(both.ctx);
    expect(both.state.walletTransfer?.feeFieldPresent).toBe(true);
    both.dispose();

    const singleDown = await prepared();
    singleDown.mock.sandbox.options.serverErrorPaths = [
      '/api/v1/transaction/01M2T',
    ];
    await runProof2(singleDown.ctx);
    // The docs-shaped TSQ record has no fee, but the single record was unreadable.
    expect(singleDown.state.walletTransfer?.feeFieldPresent).toBeNull();
    singleDown.dispose();

    const rich = await prepared({ mock: { tsqShape: 'rich' } });
    rich.mock.sandbox.options.serverErrorPaths = ['/api/v1/transaction/01M2T'];
    await runProof2(rich.ctx);
    expect(rich.state.walletTransfer?.feeFieldPresent).toBe(true);
  });
});

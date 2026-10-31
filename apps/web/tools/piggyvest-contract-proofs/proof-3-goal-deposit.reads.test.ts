import { afterEach, describe, expect, it } from 'vitest';
import { runProof3 } from './proof-3-goal-deposit';
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
const _posts = (h: ReturnType<typeof makeHarness>) =>
  h.mock.calls.filter((c) => c.method === 'POST').length;

describe('proof 3: unreadable or lagging reads are not "absent"', () => {
  async function prepared(options: Parameters<typeof makeHarness>[0] = {}) {
    const h = harness(options);
    await setupScenario(h.ctx);
    return h;
  }
  const mainFilter = (h: Awaited<ReturnType<typeof prepared>>) =>
    `/api/v1/transaction?wallet_id=${h.state.mainWalletId}`;

  it('reports unknown, not "row absent", when the main-wallet list returns 503', async () => {
    const h = await prepared();
    h.mock.sandbox.options.serverErrorPaths = [mainFilter(h)];
    const result = await runProof3(h.ctx);
    expect(answer(result, 'main_wallet_list_excludes_deposit_row')).toBe(
      'unknown'
    );
    expect(answer(result, 'transaction_list_names_goal_wallet')).toBe('yes');
    expect(result.status).toBe('inconclusive');
  });

  it('reports unknown when the main-wallet list is a 200 with an unrecognised container', async () => {
    const h = await prepared();
    const original = h.api.transactions.bind(h.api);
    h.api.transactions = async (query) =>
      query.wallet_id === h.state.mainWalletId
        ? { ...(await original(query)), ok: true, data: { rows: [] } }
        : original(query);
    const result = await runProof3(h.ctx);
    expect(answer(result, 'main_wallet_list_excludes_deposit_row')).toBe(
      'unknown'
    );
    expect(result.status).toBe('inconclusive');
  });

  it('polls the goal list within the budget when the new row is not indexed yet', async () => {
    const h = await prepared({ maxPolls: 6 });
    h.mock.sandbox.options.listLagReads = 3;
    const result = await runProof3(h.ctx);
    expect(answer(result, 'transaction_list_names_goal_wallet')).toBe('yes');
    expect(answer(result, 'main_wallet_list_excludes_deposit_row')).toBe('yes');
    expect(result.status).toBe('observed');
  });

  it('reports unknown and inconclusive when the row never shows within the budget', async () => {
    const h = await prepared({ maxPolls: 3 });
    h.mock.sandbox.options.listLagReads = 50;
    const result = await runProof3(h.ctx);
    expect(answer(result, 'transaction_list_names_goal_wallet')).toBe(
      'unknown'
    );
    expect(answer(result, 'main_wallet_list_excludes_deposit_row')).toBe(
      'unknown'
    );
    expect(answer(result, 'single_transaction_names_destination_wallet')).toBe(
      'unknown'
    );
    expect(result.status).toBe('inconclusive');
  });

  it('cannot exclude earlier rows when the pre-deposit list is unreadable, so row facts are unknown', async () => {
    const h = await prepared({
      mock: { failNetworkOnce: ['/api/v1/transaction'] },
    });
    const result = await runProof3(h.ctx);
    expect(answer(result, 'transaction_list_names_goal_wallet')).toBe(
      'unknown'
    );
    expect(answer(result, 'main_wallet_list_excludes_deposit_row')).toBe(
      'unknown'
    );
    expect(result.status).toBe('inconclusive');
  });

  it('does not say "no virtual account" when the accounts read failed or has an unrecognised shape', async () => {
    const down = await prepared();
    down.mock.sandbox.options.serverErrorPaths = ['/accounts'];
    const failed = await runProof3(down.ctx);
    expect(answer(failed, 'goal_wallet_has_own_virtual_account')).toBe(
      'unknown'
    );
    expect(answer(failed, 'goal_account_differs_from_main')).toBe('unknown');
    down.dispose();

    const odd = await prepared();
    const original = odd.api.walletAccounts.bind(odd.api);
    odd.api.walletAccounts = async (id) => ({
      ...(await original(id)),
      ok: true,
      data: { accounts: [] },
    });
    const shaped = await runProof3(odd.ctx);
    expect(answer(shaped, 'goal_wallet_has_own_virtual_account')).toBe(
      'unknown'
    );
  });

  it('publishes no account count from a failed accounts read that kept its rows', async () => {
    const h = await prepared();
    const original = h.api.walletAccounts.bind(h.api);
    h.api.walletAccounts = async (id) => ({
      ...(await original(id)),
      ok: false,
      httpStatus: 503,
    });
    const result = await runProof3(h.ctx);
    expect(result.values.goal_account_count ?? null).toBeNull();
    expect(answer(result, 'goal_wallet_has_own_virtual_account')).toBe(
      'unknown'
    );
    expect(answer(result, 'goal_account_differs_from_main')).toBe('unknown');
  });

  it('does not call the credit "other" when an earlier transfer was still landing on the goal wallet', async () => {
    const h = harness({ maxPolls: 6, mock: { balanceLagReads: 2 } });
    await setupScenario(h.ctx);
    const main = h.state.mainWalletId ?? '';
    const goal = h.state.goalWalletId ?? '';
    // An earlier wallet transfer settled in the sandbox, but its balance shows late.
    h.mock.sandbox.ledger.transfer('wallet', {
      amount: 100_000,
      source: main,
      destination: goal,
      reference: 'earlier-w2w',
    });
    for (let poll = 0; poll < 2; poll += 1) {
      h.mock.sandbox.ledger.verify(
        new URLSearchParams({ reference: 'earlier-w2w' })
      );
    }
    const result = await runProof3(h.ctx);
    expect(result.values.deposit_credit_relation).toBe('net_of_fee');
    expect(answer(result, 'credited_to_goal_wallet')).toBe('yes');
  });

  it('measures no credit while the balances are still moving', async () => {
    const h = await prepared();
    const original = h.api.wallet.bind(h.api);
    let reads = 0;
    h.api.wallet = async (id) => {
      reads += 1;
      const read = await original(id);
      const data = (read.data ?? {}) as Record<string, unknown>;
      return { ...read, data: { ...data, balance: 500_000 + reads } };
    };
    const result = await runProof3(h.ctx);
    expect(result.status).toBe('inconclusive');
    expect(answer(result, 'credited_to_goal_wallet')).toBe('unknown');
  });

  it('reports unknown when the single record is not an object', async () => {
    const h = await prepared();
    const original = h.api.transaction.bind(h.api);
    h.api.transaction = async (id, walletId) => ({
      ...(await original(id, walletId)),
      ok: true,
      data: 'not-an-object',
    });
    const result = await runProof3(h.ctx);
    expect(answer(result, 'single_transaction_names_destination_wallet')).toBe(
      'unknown'
    );
  });

  it('records whether the deposit record had a fee field only when a record was actually read', async () => {
    const readable = await prepared();
    await runProof3(readable.ctx);
    expect(readable.state.deposit?.feeFieldPresent).toBe(true);
    readable.dispose();
    const down = await prepared();
    down.mock.sandbox.options.serverErrorPaths = ['/api/v1/transaction/01M2T'];
    await runProof3(down.ctx);
    expect(down.state.deposit?.feeFieldPresent).toBeNull();
  });
});

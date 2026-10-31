import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryJournal } from './mutation-journal';
import { runProof7 } from './proof-7-interest-routing';
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

async function prepared(options: Parameters<typeof makeHarness>[0] = {}) {
  const h = harness(options);
  await setupScenario(h.ctx);
  return h;
}

describe('proof 7: readbacks after creation are polled within the budget', () => {
  it('finds interest settings that show up a few reads after creation', async () => {
    const h = await prepared({ maxPolls: 6 });
    h.mock.sandbox.options.settingsLagReads = 2;
    const result = await runProof7(h.ctx);
    expect(result.status).toBe('observed');
    expect(answer(result, 'main_wallet_readback_exposes_interest_fields')).toBe(
      'yes'
    );
    expect(
      answer(result, 'main_wallet_readback_names_payout_destination')
    ).toBe('yes');
    expect(answer(result, 'goal_without_payout_inherits_business_payout')).toBe(
      'no'
    );
    expect(result.values.interest_routing_verdict).toBe(
      'create_time_routing_verified'
    );
  });

  it('reports unknown, inconclusive and "unconfirmed" when settings never show within the budget', async () => {
    const h = await prepared({ maxPolls: 3 });
    h.mock.sandbox.options.settingsLagReads = 50;
    const result = await runProof7(h.ctx);
    expect(result.status).toBe('inconclusive');
    for (const id of [
      'main_wallet_readback_exposes_interest_fields',
      'main_wallet_readback_names_payout_destination',
      'main_wallet_accrual_flag_readable',
      'goal_without_payout_inherits_business_payout',
      'goal_explicit_readback_names_payout_destination',
    ]) {
      expect(answer(result, id), id).toBe('unknown');
    }
    expect(result.values.interest_routing_verdict).toBe('unconfirmed');
  });

  it('reports unknown when the main wallet readback itself fails', async () => {
    const h = await prepared();
    const original = h.api.wallet.bind(h.api);
    h.api.wallet = async (walletId) => ({
      ...(await original(walletId)),
      ok: false,
      httpStatus: 503,
      data: undefined,
    });
    const result = await runProof7(h.ctx);
    expect(
      answer(result, 'main_wallet_readback_names_payout_destination')
    ).toBe('unknown');
    expect(result.values.interest_routing_verdict).toBe('unconfirmed');
  });

  it('reports unknown when the readback is a 200 that is not an object', async () => {
    const h = await prepared();
    const original = h.api.wallet.bind(h.api);
    h.api.wallet = async (walletId) => ({
      ...(await original(walletId)),
      ok: true,
      data: 'text',
    });
    const result = await runProof7(h.ctx);
    expect(answer(result, 'main_wallet_readback_exposes_interest_fields')).toBe(
      'unknown'
    );
  });
});

describe('proof 7: the payout destination appears after the accrual flag', () => {
  it('keeps polling for the destination and still verifies routing', async () => {
    const h = await prepared({ maxPolls: 6 });
    h.mock.sandbox.options.payoutFieldLagReads = 2;
    const result = await runProof7(h.ctx);
    expect(result.status).toBe('observed');
    expect(
      answer(result, 'main_wallet_readback_names_payout_destination')
    ).toBe('yes');
    expect(answer(result, 'main_wallet_accrual_flag_readable')).toBe('yes');
    expect(answer(result, 'goal_without_payout_inherits_business_payout')).toBe(
      'no'
    );
    expect(
      answer(result, 'goal_explicit_readback_names_payout_destination')
    ).toBe('yes');
    expect(result.values.interest_routing_verdict).toBe(
      'create_time_routing_verified'
    );
  });
});

describe('proof 7: settings visible but the destination never appears', () => {
  it('is "unknown" and "unconfirmed" (not "no"), keeping the flags it saw', async () => {
    const h = await prepared({
      maxPolls: 3,
      mock: { payoutReadback: 'accrual_only' },
    });
    const result = await runProof7(h.ctx);
    expect(result.status).toBe('inconclusive');
    expect(answer(result, 'main_wallet_readback_exposes_interest_fields')).toBe(
      'yes'
    );
    expect(
      answer(result, 'main_wallet_readback_names_payout_destination')
    ).toBe('unknown');
    expect(answer(result, 'main_wallet_accrual_flag_readable')).toBe('yes');
    expect(answer(result, 'goal_without_payout_inherits_business_payout')).toBe(
      'unknown'
    );
    expect(
      answer(result, 'goal_explicit_readback_names_payout_destination')
    ).toBe('unknown');
    expect(result.values.interest_routing_verdict).toBe('unconfirmed');
  });

  it('says "no" only when the destination field is readable and names another wallet', async () => {
    const h = await prepared();
    const original = h.api.wallet.bind(h.api);
    h.api.wallet = async (id) => {
      const read = await original(id);
      const data =
        read.data !== null && typeof read.data === 'object' ? read.data : {};
      return {
        ...read,
        data: { ...data, interest_payout_wallet: 'some-other-wallet-id' },
      };
    };
    const result = await runProof7(h.ctx);
    expect(
      answer(result, 'main_wallet_readback_names_payout_destination')
    ).toBe('no');
    expect(result.values.interest_routing_verdict).toBe(
      'create_time_routing_accepted_but_unverifiable'
    );
  });
});

describe('proof 7: an unreadable wallet list is not "wallet absent"', () => {
  it('leaves goal-wallet existence unknown when a resumed slot cannot be looked up', async () => {
    const journal = createMemoryJournal();
    const first = await prepared({ journal });
    await runProof7(first.ctx);
    const { customers, wallets } = first.mock.sandbox;
    first.dispose();

    const h = harness({ journal, runId: 'run2' });
    h.mock.sandbox.customers = customers;
    h.mock.sandbox.wallets = wallets;
    await setupScenario(h.ctx);
    h.mock.sandbox.options.serverErrorPaths = [
      '/api/v1/wallet/api/wallet-type',
    ];
    const result = await runProof7(h.ctx);
    expect(answer(result, 'goal_without_payout_created')).toBe('unknown');
    expect(result.values.wallet_list_interest_field_names ?? null).toBeNull();
  });
});

describe('proof 7: a failed wallet list is not a rediscovery', () => {
  it('does not pick the main wallet from a 503 that kept its rows', async () => {
    const journal = createMemoryJournal();
    const first = await prepared({ journal });
    await runProof7(first.ctx);
    const { customers, wallets } = first.mock.sandbox;
    first.dispose();

    const h = harness({ journal, runId: 'run2' });
    h.mock.sandbox.customers = customers;
    h.mock.sandbox.wallets = wallets;
    await setupScenario(h.ctx);
    const original = h.api.customerWallets.bind(h.api);
    h.api.customerWallets = async (customerId, order) => ({
      ...(await original(customerId, order)),
      ok: false,
      httpStatus: 503,
    });
    const result = await runProof7(h.ctx);
    expect(answer(result, 'main_wallet_readback_exposes_interest_fields')).toBe(
      'unknown'
    );
    expect(
      answer(result, 'main_wallet_readback_names_payout_destination')
    ).toBe('unknown');
  });
});

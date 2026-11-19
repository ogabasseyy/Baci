import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryJournal } from './mutation-journal';
import { runProof1 } from './proof-1-return-if-exist';
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

describe('proof 1: unreadable, lagging or unrecognised reads are never "no"', () => {
  async function prepared(options: Parameters<typeof makeHarness>[0] = {}) {
    const h = harness(options);
    await setupScenario(h.ctx);
    return h;
  }
  const emptyList = (call: object) => ({
    ...call,
    ok: true,
    data: { paginatedPayload: { edges: [] } },
  });

  it('answers unknown for the identifier lookup and keeps adoption unconfirmed when the lookup returns 503', async () => {
    const h = await prepared();
    h.mock.sandbox.options.serverErrorPaths = [
      '/api/v1/customers?third_party_identifier',
    ];
    const result = await runProof1(h.ctx);
    expect(answer(result, 'lookup_by_identifier_finds_customer')).toBe(
      'unknown'
    );
    expect(answer(result, 'list_echoes_identifier')).toBe('unknown');
    expect(result.values.adoption_rule).toBe('unconfirmed');
  });

  it('answers unknown for a 200 whose list container is not recognised', async () => {
    const h = await prepared();
    const original = h.api.customersByIdentifier.bind(h.api);
    h.api.customersByIdentifier = async (id) => ({
      ...(await original(id)),
      ok: true,
      data: { rows: [] },
    });
    const result = await runProof1(h.ctx);
    expect(answer(result, 'lookup_by_identifier_finds_customer')).toBe(
      'unknown'
    );
    expect(result.values.adoption_rule).toBe('unconfirmed');
  });

  it('polls a lagging lookup within the budget and then finds the customer', async () => {
    const h = await prepared({ maxPolls: 6 });
    const original = h.api.customersByIdentifier.bind(h.api);
    let calls = 0;
    h.api.customersByIdentifier = async (id) => {
      calls += 1;
      const real = await original(id);
      return calls <= 2 ? (emptyList(real) as typeof real) : real;
    };
    const result = await runProof1(h.ctx);
    expect(answer(result, 'lookup_by_identifier_finds_customer')).toBe('yes');
    expect(result.values.adoption_rule).toBe('supported');
  });

  it('does not call a just-created customer "not found" when the lookup never catches up', async () => {
    const h = await prepared({ maxPolls: 3 });
    expect(h.state.createdNewCustomer).toBe(true);
    const original = h.api.customersByIdentifier.bind(h.api);
    h.api.customersByIdentifier = async (id) =>
      emptyList(await original(id)) as Awaited<ReturnType<typeof original>>;
    const result = await runProof1(h.ctx);
    expect(answer(result, 'lookup_by_identifier_finds_customer')).toBe(
      'unknown'
    );
    expect(result.values.adoption_rule).not.toBe('supported');
  });

  it('answers no only for a customer that already existed and a lookup that really lists nobody', async () => {
    const seeded = await prepared();
    const { customers, wallets } = seeded.mock.sandbox;
    seeded.dispose();
    const h = harness({
      journal: createMemoryJournal(),
      runId: 'run2',
      maxPolls: 2,
    });
    h.mock.sandbox.customers = customers;
    h.mock.sandbox.wallets = wallets;
    await setupScenario(h.ctx);
    const original = h.api.customersByIdentifier.bind(h.api);
    h.api.customersByIdentifier = async (id) =>
      emptyList(await original(id)) as Awaited<ReturnType<typeof original>>;
    const result = await runProof1(h.ctx);
    expect(h.state.createdNewCustomer).toBe(false);
    expect(answer(result, 'lookup_by_identifier_finds_customer')).toBe('no');
  });

  it('answers unknown for the owner-binding finding when the wallet read fails', async () => {
    const h = await prepared();
    h.mock.sandbox.options.serverErrorPaths = [
      `/api/v1/wallet/${h.state.createdWalletId}`,
    ];
    const result = await runProof1(h.ctx);
    expect(answer(result, 'wallet_retrieve_exposes_customer_binding')).toBe(
      'unknown'
    );
  });

  it('answers unknown for default-wallet findings when the wallet list cannot be read', async () => {
    const h = await prepared();
    h.mock.sandbox.options.serverErrorPaths = [
      '/api/v1/wallet/api/wallet-type',
    ];
    const result = await runProof1(h.ctx);
    expect(answer(result, 'default_wallet_is_earliest_created')).toBe(
      'unknown'
    );
    expect(answer(result, 'explicit_default_flag_in_wallet_list')).toBe(
      'unknown'
    );
    expect(result.values.default_wallet_position_ascending).toBeNull();
    expect(result.status).toBe('inconclusive');
  });

  it('polls a wallet list that does not yet include every known wallet', async () => {
    const h = await prepared({ maxPolls: 6 });
    const original = h.api.customerWallets.bind(h.api);
    let calls = 0;
    h.api.customerWallets = async (customerId, order) => {
      calls += 1;
      const real = await original(customerId, order);
      if (calls > 2) return real;
      const edges = (real.data as { paginatedPayload: { edges: unknown[] } })
        .paginatedPayload.edges;
      return {
        ...real,
        data: { paginatedPayload: { edges: edges.slice(0, 1) } },
      };
    };
    const result = await runProof1(h.ctx);
    expect(result.values.wallet_count).toBe(2);
    expect(answer(result, 'default_wallet_is_earliest_created')).toBe('yes');
  });

  it('answers unknown when the wallet list never lists every known wallet within the budget', async () => {
    const h = await prepared({ maxPolls: 2 });
    const original = h.api.customerWallets.bind(h.api);
    h.api.customerWallets = async (customerId, order) => {
      const real = await original(customerId, order);
      const edges = (real.data as { paginatedPayload: { edges: unknown[] } })
        .paginatedPayload.edges;
      return {
        ...real,
        data: { paginatedPayload: { edges: edges.slice(0, 1) } },
      };
    };
    const result = await runProof1(h.ctx);
    expect(answer(result, 'default_wallet_is_earliest_created')).toBe(
      'unknown'
    );
    expect(answer(result, 'explicit_default_flag_in_wallet_list')).toBe(
      'unknown'
    );
    expect(result.status).toBe('inconclusive');
  });
});

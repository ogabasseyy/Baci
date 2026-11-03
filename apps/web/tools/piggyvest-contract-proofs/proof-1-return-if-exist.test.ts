import { afterEach, describe, expect, it } from 'vitest';
import { resolvePiggyvestStagingSyntheticIdentity } from '@/lib/piggyvest/staging-synthetic-identity';
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
const posts = (h: ReturnType<typeof makeHarness>) =>
  h.mock.calls.filter((c) => c.method === 'POST').length;

async function run(options: Parameters<typeof makeHarness>[0] = {}) {
  const h = harness(options);
  await setupScenario(h.ctx);
  const result = await runProof1(h.ctx);
  return { h, result };
}

describe('proof 1: create-customer re-POST with returnIfExist=true', () => {
  it('shows an idempotent re-POST, a working identifier lookup and an identifiable default wallet', async () => {
    const { h, result } = await run();
    expect(result.status).toBe('observed');
    expect(answer(result, 'repost_returns_same_wallet_id')).toBe('yes');
    expect(answer(result, 'repost_returns_same_customer_id')).toBe('yes');
    expect(answer(result, 'repost_reports_existing_customer')).toBe('yes');
    expect(answer(result, 'lookup_by_identifier_finds_customer')).toBe('yes');
    expect(answer(result, 'list_echoes_identifier')).toBe('yes');
    expect(answer(result, 'create_response_echoes_identifier')).toBe('no');
    expect(answer(result, 'default_wallet_is_earliest_created')).toBe('yes');
    expect(answer(result, 'explicit_default_flag_in_wallet_list')).toBe('no');
    expect(result.values.adoption_rule).toBe('supported');
    expect(result.values.default_wallet_position_default_order).toBe(
      'last_of_2'
    );
    expect(result.values.default_wallet_position_ascending).toBe('first_of_2');
    expect(h.redactor.leaks(JSON.stringify(result))).toEqual([]);
  });

  it('records the shapes of the re-POST response, the lookup and the wallet list', async () => {
    const { result } = await run();
    const names = result.shapes.map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'POST /customers (re-POST)',
        'GET /customers?third_party_identifier=',
        'GET wallet list (customer_id filter)',
        'GET /wallet/:id (default wallet)',
      ])
    );
    const repost = result.shapes.find(
      (s) => s.name === 'POST /customers (re-POST)'
    );
    expect(repost?.fields.map((f) => f.path)).toEqual([
      'customer_id',
      'wallet_id',
      'new_customer',
    ]);
  });

  it('says NO when the re-POST hands back a different wallet (adoption must not be automatic)', async () => {
    const { result } = await run({
      mock: { repostReturnsOriginalDefault: false },
    });
    expect(answer(result, 'repost_returns_same_wallet_id')).toBe('no');
    expect(result.values.adoption_rule).toBe('not_supported');
  });

  it('notices an echoed identifier and a list that does not echo it', async () => {
    const echoed = await run({
      mock: { echoThirdPartyIdentifierOnCreate: true },
    });
    expect(answer(echoed.result, 'create_response_echoes_identifier')).toBe(
      'yes'
    );
    echoed.h.dispose();
    const silent = await run({ mock: { customerListEchoesIdentifier: false } });
    expect(answer(silent.result, 'list_echoes_identifier')).toBe('no');
    expect(answer(silent.result, 'lookup_by_identifier_finds_customer')).toBe(
      'yes'
    );
  });

  it('reports an unexpected list container instead of crashing', async () => {
    const { result } = await run({ mock: { customerListContainer: 'array' } });
    expect(result.values.lookup_list_container).toBe('array');
  });

  it('reads the creation times from the wallets themselves when the list rows carry none', async () => {
    const { result } = await run({
      mock: { walletListIncludesCreatedAt: false },
    });
    expect(answer(result, 'default_wallet_is_earliest_created')).toBe('yes');
  });

  it('cannot identify the default wallet by order when no creation time can be read anywhere', async () => {
    const h = harness({ mock: { walletListIncludesCreatedAt: false } });
    await setupScenario(h.ctx);
    for (const view of h.state.wallets) view.createdAt = null;
    const result = await runProof1(h.ctx);
    expect(answer(result, 'default_wallet_is_earliest_created')).toBe(
      'unknown'
    );
    expect(result.status).toBe('inconclusive');
  });

  it('read-only mode sends no POST and leaves the re-POST questions unknown', async () => {
    const seeded = harness();
    await setupScenario(seeded.ctx);
    const sandbox = seeded.mock.sandbox;
    seeded.dispose();

    const h = harness({ mode: 'live-readonly' });
    h.mock.sandbox.customers = sandbox.customers;
    h.mock.sandbox.wallets = sandbox.wallets;
    await setupScenario(h.ctx);
    const result = await runProof1(h.ctx);
    expect(posts(h)).toBe(0);
    expect(answer(result, 'repost_returns_same_wallet_id')).toBe('unknown');
    expect(answer(result, 'lookup_by_identifier_finds_customer')).toBe('yes');
    expect(result.values.adoption_rule).toBe('unconfirmed');
  });

  it('does not resend the re-POST on a re-run and says so', async () => {
    const journal = createMemoryJournal();
    const first = await run({ journal });
    const sandbox = first.h.mock.sandbox;
    first.h.dispose();
    const h = harness({ journal, runId: 'run2' });
    h.mock.sandbox.customers = sandbox.customers;
    h.mock.sandbox.wallets = sandbox.wallets;
    await setupScenario(h.ctx);
    const result = await runProof1(h.ctx);
    expect(posts(h)).toBe(0);
    expect(result.status).toBe('inconclusive');
    expect(result.notes.join(' ')).toMatch(/--new-attempt/);
    expect(answer(result, 'repost_returns_same_wallet_id')).toBe('unknown');
  });

  it('is inconclusive, not failed, when the QA customer does not exist', async () => {
    const h = harness({ mode: 'live-readonly' });
    await setupScenario(h.ctx);
    const result = await runProof1(h.ctx);
    expect(result.status).toBe('inconclusive');
  });
});

// keeps the import used for documentation of the identity derivation
void resolvePiggyvestStagingSyntheticIdentity;

describe('proof 1: an existing customer is not ground truth', () => {
  it('does not report adoption as supported when two re-POSTs agree on the wrong wallet', async () => {
    const seeded = harness({ mock: { repostReturnsOriginalDefault: false } });
    await setupScenario(seeded.ctx);
    const { customers, wallets } = seeded.mock.sandbox;
    seeded.dispose();

    const h = harness({
      mock: { repostReturnsOriginalDefault: false },
      journal: createMemoryJournal(),
      runId: 'run2',
    });
    h.mock.sandbox.customers = customers;
    h.mock.sandbox.wallets = wallets;
    await setupScenario(h.ctx);
    const result = await runProof1(h.ctx);
    expect(h.state.createdNewCustomer).toBe(false);
    expect(answer(result, 'repost_returns_same_wallet_id')).toBe('no');
    expect(result.values.adoption_rule).toBe('not_supported');
    expect(
      result.findings.find((f) => f.id === 'repost_returns_same_wallet_id')
        ?.detail
    ).toMatch(/earliest-created/);
  });
});

describe('proof 1: adoption needs ground truth', () => {
  it('reports unconfirmed, not supported, when the baseline is only the earliest-created heuristic', async () => {
    const seeded = harness();
    await setupScenario(seeded.ctx);
    const { customers, wallets } = seeded.mock.sandbox;
    seeded.dispose();

    const h = harness({ journal: createMemoryJournal(), runId: 'run2' });
    h.mock.sandbox.customers = customers;
    h.mock.sandbox.wallets = wallets;
    await setupScenario(h.ctx);
    const result = await runProof1(h.ctx);
    expect(h.state.createdWalletId).toBeNull();
    expect(answer(result, 'repost_returns_same_wallet_id')).toBe('yes');
    expect(result.values.adoption_rule).toBe('unconfirmed');
  });
});

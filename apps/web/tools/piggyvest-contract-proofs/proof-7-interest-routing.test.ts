import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryJournal } from './mutation-journal';
import { runProof7 } from './proof-7-interest-routing';
import { proof7Key } from './qa-keys';
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
  h.mock.calls.filter((c) => c.method === 'POST').map((c) => c.pathname);

async function run(options: Parameters<typeof makeHarness>[0] = {}) {
  const h = harness(options);
  await setupScenario(h.ctx);
  const before = posts(h).length;
  const result = await runProof7(h.ctx);
  return { h, result, newPosts: posts(h).slice(before) };
}

describe('proof 7: main-wallet interest routing at creation', () => {
  it('creates a new QA customer with a payout wallet, reads it back, and tests both goal variants', async () => {
    const { h, result, newPosts } = await run();
    expect(result.status).toBe('observed');
    expect(newPosts).toEqual([
      '/api/v1/customers',
      '/api/v1/wallet/sub-account',
      '/api/v1/wallet/sub-account',
    ]);
    expect(answer(result, 'customer_create_with_payout_accepted')).toBe('yes');
    expect(answer(result, 'customer_created_fresh')).toBe('yes');
    expect(answer(result, 'main_wallet_readback_exposes_interest_fields')).toBe(
      'yes'
    );
    expect(
      answer(result, 'main_wallet_readback_names_payout_destination')
    ).toBe('yes');
    expect(answer(result, 'main_wallet_accrual_flag_readable')).toBe('yes');
    expect(answer(result, 'goal_without_payout_created')).toBe('yes');
    expect(answer(result, 'goal_without_payout_inherits_business_payout')).toBe(
      'no'
    );
    expect(answer(result, 'goal_explicit_payout_accepted')).toBe('yes');
    expect(
      answer(result, 'goal_explicit_readback_names_payout_destination')
    ).toBe('yes');
    expect(result.values.interest_routing_verdict).toBe(
      'create_time_routing_verified'
    );
    expect(result.values.main_wallet_payout_field_paths).toBe(
      'interest_payout_wallet'
    );
    expect(h.redactor.leaks(JSON.stringify(result))).toEqual([]);
  });

  it('uses a NEW derived QA customer, never the one the other proofs use', async () => {
    const { h } = await run();
    expect(h.mock.sandbox.customers).toHaveLength(2);
    expect(h.mock.sandbox.customers.map((c) => c.tpi)).toEqual([
      'pvbproof:qa-customer-0001',
      `pvbproof:${proof7Key('qa-customer-0001', 1)}`,
    ]);
  });

  it('records the exact rejection (status, client code, redacted message) and stops short of a verdict', async () => {
    const { result } = await run({
      mock: { customerPayoutWallet: 'rejected' },
    });
    expect(answer(result, 'customer_create_with_payout_accepted')).toBe('no');
    expect(result.values.create_error_http_status).toBe(400);
    expect(result.values.create_error_client_code).toBe(
      'PIGGYVEST_REQUEST_ERROR'
    );
    expect(result.values.create_error_message).toBe(
      'Invalid interest payout wallet'
    );
    expect(result.values.interest_routing_verdict).toBe(
      'create_time_routing_rejected'
    );
    expect(
      answer(result, 'main_wallet_readback_names_payout_destination')
    ).toBe('unknown');
  });

  it('still tests the sub-wallet payout parameter on the main QA customer after a rejection', async () => {
    const { result } = await run({
      mock: { customerPayoutWallet: 'rejected' },
    });
    expect(answer(result, 'goal_explicit_payout_accepted')).toBe('yes');
    expect(result.notes.join(' ')).toMatch(/main QA customer/);
  });

  it('does not claim "no settings" when the readback never shows any within the budget', async () => {
    const { result } = await run({ mock: { payoutReadback: 'none' } });
    expect(answer(result, 'customer_create_with_payout_accepted')).toBe('yes');
    expect(answer(result, 'main_wallet_readback_exposes_interest_fields')).toBe(
      'unknown'
    );
    expect(
      answer(result, 'main_wallet_readback_names_payout_destination')
    ).toBe('unknown');
    expect(result.values.interest_routing_verdict).toBe('unconfirmed');
  });

  it('records a sub-account endpoint that rejects interest_payout_wallet', async () => {
    const { result } = await run({ mock: { subAccountAcceptsPayout: false } });
    expect(answer(result, 'goal_explicit_payout_accepted')).toBe('no');
    expect(result.values.goal_explicit_error_message).toBe(
      'Invalid interest payout wallet'
    );
    expect(answer(result, 'goal_without_payout_created')).toBe('yes');
  });

  it('flags a goal wallet that inherits the customer payout wallet (goal interest would reach Ogabassey)', async () => {
    const { result } = await run({ mock: { subWalletInheritsPayout: true } });
    expect(answer(result, 'goal_without_payout_inherits_business_payout')).toBe(
      'yes'
    );
    expect(result.notes.join(' ')).toMatch(/inherit/i);
  });

  it('does not claim a verdict when the customer already existed (settings are not re-applied)', async () => {
    const seeded = await run();
    const { customers, wallets } = seeded.h.mock.sandbox;
    seeded.h.dispose();
    const h = harness({ journal: createMemoryJournal(), runId: 'run2' });
    h.mock.sandbox.customers = customers;
    h.mock.sandbox.wallets = wallets;
    await setupScenario(h.ctx);
    const result = await runProof7(h.ctx);
    expect(answer(result, 'customer_created_fresh')).toBe('no');
    expect(result.values.interest_routing_verdict).toBe('unconfirmed');
    expect(result.notes.join(' ')).toMatch(/not re-applied/);
  });

  it('is skipped without a business wallet id and never sends a request for it', async () => {
    const { result, newPosts } = await run({ businessWalletId: null });
    expect(result.status).toBe('skipped');
    expect(newPosts).toEqual([]);
    expect(result.reason).toMatch(/PVB_PROOF_BUSINESS_WALLET_ID/);
  });

  it('is skipped in read-only mode with no POST', async () => {
    const h = harness({ mode: 'live-readonly' });
    await setupScenario(h.ctx);
    const result = await runProof7(h.ctx);
    expect(result.status).toBe('skipped');
    expect(posts(h)).toEqual([]);
  });

  it('never resends on a re-run but still reads back what exists', async () => {
    const journal = createMemoryJournal();
    const first = await run({ journal });
    const { customers, wallets } = first.h.mock.sandbox;
    first.h.dispose();
    const h = harness({ journal, runId: 'run2' });
    h.mock.sandbox.customers = customers;
    h.mock.sandbox.wallets = wallets;
    await setupScenario(h.ctx);
    const before = posts(h).length;
    const result = await runProof7(h.ctx);
    expect(posts(h).length).toBe(before);
    expect(result.status).toBe('inconclusive');
    expect(result.notes.join(' ')).toMatch(/--new-attempt/);
    expect(
      answer(result, 'main_wallet_readback_names_payout_destination')
    ).toBe('yes');
  });

  it('keeps the business wallet id out of the evidence', async () => {
    const { h, result } = await run();
    expect(JSON.stringify(result)).not.toContain(
      h.mock.sandbox.businessWalletId
    );
  });
});

describe('proof 7: key length and customer identity', () => {
  it('derives a P7 key that fits the journal even for the longest allowlisted QA key', async () => {
    const { result, h } = await run({ qaKey: 'q'.repeat(64) });
    expect(result.status).toBe('observed');
    const tpis = h.mock.sandbox.customers.map((c) => c.tpi);
    expect(tpis[1]).toBe(`pvbproof:${proof7Key('q'.repeat(64), 1)}`);
    expect(h.journal.entries().every((e) => e.qaKey.length <= 64)).toBe(true);
  });

  it('never creates sub-wallets on a customer it could not prove is its own', async () => {
    // Run 1: the provider rejects the P7 create, so the goal slots belong to the main QA customer.
    const first = await run({ mock: { customerPayoutWallet: 'rejected' } });
    const { journal } = first.h;
    const { customers, wallets } = first.h.mock.sandbox;
    first.h.dispose();
    // Run 2: the create slot resumes; the lookup now returns an unrelated customer.
    const h = harness({ journal, runId: 'run2' });
    h.mock.sandbox.customers = customers;
    h.mock.sandbox.wallets = wallets;
    await setupScenario(h.ctx);
    const original = h.api.customersByIdentifier.bind(h.api);
    h.api.customersByIdentifier = async (identifier: string) => {
      const call = await original(identifier);
      return identifier.endsWith(proof7Key('qa-customer-0001', 1))
        ? {
            ...call,
            data: {
              paginatedPayload: {
                edges: [{ id: 'unrelated-customer-1', name: 'x' }],
              },
            },
          }
        : call;
    };
    const before = posts(h).length;
    await runProof7(h.ctx);
    const newPosts = posts(h).slice(before);
    expect(newPosts).not.toContain('/api/v1/wallet/sub-account');
    expect(
      h.mock.sandbox.customers.some((c) => c.id === 'unrelated-customer-1')
    ).toBe(false);
  });
});

describe('proof 7: a new attempt re-tests with fresh names', () => {
  it('creates a new payout customer and fresh sub-wallet names instead of tripping over attempt 1', async () => {
    const journal = createMemoryJournal();
    const first = await run({ journal });
    const earlier = first.h.mock.sandbox;
    first.h.dispose();

    const h = harness({ journal, attempt: 2, runId: 'run2' });
    h.mock.sandbox.adopt(earlier);
    await setupScenario(h.ctx);
    const result = await runProof7(h.ctx);
    expect(result.status).toBe('observed');
    expect(answer(result, 'customer_created_fresh')).toBe('yes');
    expect(answer(result, 'goal_without_payout_created')).toBe('yes');
    expect(answer(result, 'goal_explicit_payout_accepted')).toBe('yes');
    expect(h.mock.sandbox.customers.map((c) => c.tpi)).toContain(
      `pvbproof:${proof7Key('qa-customer-0001', 2)}`
    );
  });
});

describe('proof 7: inheritance needs a readable destination', () => {
  it('says no when the goal readback shows an empty payout field next to the main wallet naming the business wallet', async () => {
    const { result } = await run();
    expect(answer(result, 'goal_without_payout_inherits_business_payout')).toBe(
      'no'
    );
  });

  it('says unknown when the goal readback omits its payout destination (only the accrual flag is there)', async () => {
    const { result } = await run({ mock: { goalReadbackOmitsPayout: true } });
    expect(
      answer(result, 'main_wallet_readback_names_payout_destination')
    ).toBe('yes');
    expect(answer(result, 'goal_without_payout_inherits_business_payout')).toBe(
      'unknown'
    );
    expect(
      result.findings.find(
        (f) => f.id === 'goal_without_payout_inherits_business_payout'
      )?.detail
    ).toMatch(/destination/);
  });
});

describe('proof 7: QA keys that share a prefix', () => {
  it('get distinct customers and journal scopes, neither affecting the other', async () => {
    const A = `${'q'.repeat(57)}AAAAAAA`;
    const B = `${'q'.repeat(57)}BBBBBBB`;
    const journal = createMemoryJournal();
    const first = await run({ journal, qaKey: A });
    const { customers, wallets } = first.h.mock.sandbox;
    first.h.dispose();

    const h = harness({ journal, qaKey: B, runId: 'run2' });
    h.mock.sandbox.customers = customers;
    h.mock.sandbox.wallets = wallets;
    await setupScenario(h.ctx);
    const result = await runProof7(h.ctx);

    expect(result.status).toBe('observed');
    expect(answer(result, 'customer_created_fresh')).toBe('yes');
    const tpis = h.mock.sandbox.customers.map((c) => c.tpi);
    expect(tpis).toContain(`pvbproof:${proof7Key(A, 1)}`);
    expect(tpis).toContain(`pvbproof:${proof7Key(B, 1)}`);
    const scopes = new Set(journal.entries().map((e) => e.qaKey));
    expect(scopes.has(proof7Key(A, 1))).toBe(true);
    expect(scopes.has(proof7Key(B, 1))).toBe(true);
  });
});

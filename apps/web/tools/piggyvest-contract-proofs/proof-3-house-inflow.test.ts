import { afterEach, describe, expect, it } from 'vitest';
import { dataOf, type MockCreated } from './mock-reply.test-support';
import { createMemoryJournal } from './mutation-journal';
import { runHouseInflow } from './proof-3-house-inflow';
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
const fundings = (h: ReturnType<typeof harness>) =>
  h.mock.calls.filter(
    (call) =>
      call.method === 'POST' &&
      call.pathname === '/api/v1/transfer/test/funding'
  ).length;

async function inflow(h: ReturnType<typeof harness>, setup = true) {
  if (setup) await setupScenario(h.ctx);
  const b = new ProofBuilder('p3', 'Goal deposit');
  await runHouseInflow(h.ctx, b);
  return b.build(h.ctx);
}

describe('proof 3: house-wallet inflow shape', () => {
  it('funds the admitted house wallet once and records the credit row shape', async () => {
    const h = harness();
    await setupScenario(h.ctx);
    const before = fundings(h);
    const result = await inflow(h, false);
    expect(fundings(h)).toBe(before + 1);
    expect(result.status).toBe('observed');
    expect(answer(result, 'house_wallet_unbound_to_customer')).toBe('yes');
    expect(answer(result, 'house_inflow_credited')).toBe('yes');
    expect(answer(result, 'house_inflow_row_listed')).toBe('yes');
    expect(answer(result, 'house_inflow_webhook_shape')).toBe('unknown');
    expect(result.values).toMatchObject({
      house_funding_http_status: 200,
      house_inflow_row_type: 'credit',
      house_inflow_row_category: 'inflow_transaction',
      house_inflow_fee_kobo: 5_000,
      house_credit_relation: 'net_of_fee',
    });
    expect(
      result.shapes.map((s) => s.name).filter((n) => n.includes('house'))
    ).toEqual([
      'GET /transaction (house wallet credit row)',
      'GET /transaction/:id (house wallet deposit)',
    ]);
    expect(h.mock.sandbox.house.balance).toBe(195_000);
    expect(h.redactor.leaks(JSON.stringify(result))).toEqual([]);
  });

  it('sends nothing when no business wallet is configured', async () => {
    const h = harness({ businessWalletId: null });
    const result = await inflow(h);
    expect(fundings(h)).toBe(1); // the scenario's own main-wallet funding
    expect(result.status).toBe('inconclusive');
    expect(result.reason).toMatch(/PVB_PROOF_BUSINESS_WALLET_ID/);
    expect(answer(result, 'house_wallet_unbound_to_customer')).toBe('unknown');
  });

  it('refuses a business wallet that belongs to an API customer', async () => {
    const h = harness();
    const other = dataOf<MockCreated>(
      h.mock.sandbox.createCustomer(
        {
          bvn: '00099999999',
          email: 'synthetic+0ther0000000@example.test',
          name: 'Synthetic Customer',
          phone: '+234000999999',
        },
        true
      )
    );
    h.ctx.businessWalletId = other.wallet_id;
    const result = await inflow(h);
    expect(fundings(h)).toBe(1);
    expect(answer(result, 'house_wallet_unbound_to_customer')).toBe('no');
    expect(result.status).toBe('inconclusive');
  });

  it('is inconclusive, without guessing, when the deposit does not settle', async () => {
    const h = harness();
    await setupScenario(h.ctx);
    h.mock.sandbox.options.fundingSettles = false;
    const result = await inflow(h, false);
    expect(result.status).toBe('inconclusive');
    expect(answer(result, 'house_inflow_credited')).toBe('unknown');
    expect(result.values.house_credit_relation).toBeUndefined();
  });

  it('never re-funds on a re-run, and sends nothing in read-only mode', async () => {
    const journal = createMemoryJournal();
    const first = harness({ journal });
    await inflow(first);
    const sandbox = first.mock.sandbox;
    first.dispose();
    const h = harness({ journal });
    h.mock.sandbox.adopt(sandbox);
    await setupScenario(h.ctx);
    const before = fundings(h);
    const result = await inflow(h, false);
    expect(fundings(h)).toBe(before);
    expect(result.status).toBe('inconclusive');
    h.dispose();

    const readonly = harness({ mode: 'live-readonly' });
    const r = await inflow(readonly);
    expect(fundings(readonly)).toBe(0);
    expect(r.status).toBe('inconclusive');
  });
});

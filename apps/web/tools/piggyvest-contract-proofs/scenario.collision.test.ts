import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryJournal } from './mutation-journal';
import { setupScenario } from './scenario';
import { makeHarness } from './test-harness.test-support';

/**
 * Two valid QA keys whose synthetic identities share the SAME BVN (but have
 * different emails and third-party identifiers). With returnIfExist=true the
 * provider hands the first key's customer back for the second key.
 */
const KEY_A = 'qa-customer-011234';
const KEY_B = 'qa-customer-012514';

let disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
});
function harness(...args: Parameters<typeof makeHarness>) {
  const h = makeHarness(...args);
  disposers.push(h.dispose);
  return h;
}
const posts = (h: ReturnType<typeof makeHarness>) =>
  h.mock.calls.filter((c) => c.method === 'POST').map((c) => c.pathname);

async function seededByKeyA() {
  const first = harness({ qaKey: KEY_A });
  await setupScenario(first.ctx);
  first.dispose();
  return first;
}

describe('setupScenario: a returnIfExist answer must belong to the selected QA key', () => {
  it("refuses another key's customer found through a synthetic BVN collision", async () => {
    const first = await seededByKeyA();
    const victimWallets = first.mock.sandbox.wallets.map((w) => ({
      id: w.id,
      balance: w.balance,
    }));

    const second = harness({
      qaKey: KEY_B,
      journal: createMemoryJournal(),
      runId: 'run2',
    });
    second.mock.sandbox.adopt(first.mock.sandbox);
    await setupScenario(second.ctx);

    // Only the create call itself was sent: no sub-wallet, no funding.
    expect(posts(second)).toEqual(['/api/v1/customers']);
    expect(second.state.customerId).toBeNull();
    expect(second.state.createdWalletId).toBeNull();
    expect(second.state.authorized.size).toBe(0);
    expect(second.state.wallets).toEqual([]);
    expect(second.state.notes.join(' ')).toMatch(/not proven|not verified/i);
    // The other key's wallets are untouched.
    expect(
      second.mock.sandbox.wallets.map((w) => ({ id: w.id, balance: w.balance }))
    ).toEqual(victimWallets);
  });

  it('does not leak the foreign customer id into the notes', async () => {
    const first = await seededByKeyA();
    const foreignId = first.mock.sandbox.customers[0]?.id ?? '';
    const second = harness({ qaKey: KEY_B, runId: 'run2' });
    second.mock.sandbox.adopt(first.mock.sandbox);
    await setupScenario(second.ctx);
    expect(second.state.notes.join(' ')).not.toContain(foreignId);
  });

  it('refuses an existing customer when the verifying lookup is unavailable (fails closed)', async () => {
    const first = await seededByKeyA();
    const rerun = harness({
      qaKey: KEY_A,
      journal: createMemoryJournal(),
      runId: 'run2',
    });
    rerun.mock.sandbox.adopt(first.mock.sandbox);
    rerun.mock.sandbox.options.serverErrorPaths = ['third_party_identifier='];
    await setupScenario(rerun.ctx);
    expect(posts(rerun)).toEqual(['/api/v1/customers']);
    expect(rerun.state.customerId).toBeNull();
  });

  it('refuses when the answer does not say whether the customer is new and the lookup finds no match', async () => {
    const first = await seededByKeyA();
    const second = harness({ qaKey: KEY_B, runId: 'run2' });
    second.mock.sandbox.adopt(first.mock.sandbox);
    const original = second.api.createCustomer.bind(second.api);
    second.api.createCustomer = async (qa, slot) => {
      const sent = await original(qa, slot);
      if (sent.kind !== 'sent') return sent;
      const { new_customer: _dropped, ...rest } = sent.call.data as Record<
        string,
        unknown
      >;
      return { ...sent, call: { ...sent.call, data: rest } };
    };
    await setupScenario(second.ctx);
    expect(posts(second)).toEqual(['/api/v1/customers']);
    expect(second.state.customerId).toBeNull();
  });

  it('refuses when the lookup verifies a DIFFERENT customer than the create answer named', async () => {
    const first = await seededByKeyA();
    const rerun = harness({ qaKey: KEY_A, runId: 'run2' });
    rerun.mock.sandbox.adopt(first.mock.sandbox);
    const original = rerun.api.createCustomer.bind(rerun.api);
    rerun.api.createCustomer = async (qa, slot) => {
      const sent = await original(qa, slot);
      if (sent.kind !== 'sent') return sent;
      const data = sent.call.data as Record<string, unknown>;
      return {
        ...sent,
        call: {
          ...sent.call,
          data: {
            ...data,
            customer_id: '99999999-9999-4999-8999-999999999999',
          },
        },
      };
    };
    await setupScenario(rerun.ctx);
    expect(posts(rerun)).toEqual(['/api/v1/customers']);
    expect(rerun.state.customerId).toBeNull();
  });
});

describe('setupScenario: a verified existing customer is still used', () => {
  it("adopts the key's own existing customer once the lookup proves it, and carries on", async () => {
    const first = await seededByKeyA();
    const rerun = harness({
      qaKey: KEY_A,
      journal: createMemoryJournal(),
      runId: 'run2',
    });
    rerun.mock.sandbox.adopt(first.mock.sandbox);
    await setupScenario(rerun.ctx);
    expect(rerun.state.createdNewCustomer).toBe(false);
    expect(rerun.state.customerId).toBe(first.mock.sandbox.customers[0]?.id);
    expect(rerun.state.createdWalletId).toBeNull();
    expect(rerun.state.goalWalletId).not.toBeNull();
  });

  it("trusts a brand-new customer without a lookup (it was created from this key's own body)", async () => {
    const h = harness({ qaKey: KEY_B });
    await setupScenario(h.ctx);
    expect(h.state.createdNewCustomer).toBe(true);
    expect(h.state.customerId).not.toBeNull();
    expect(
      h.mock.calls.filter(
        (c) => c.method === 'GET' && c.pathname === '/api/v1/customers'
      )
    ).toHaveLength(0);
  });
});

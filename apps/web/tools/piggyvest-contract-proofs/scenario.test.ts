import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryJournal } from './mutation-journal';
import { setupScenario } from './scenario';
import { makeHarness } from './test-harness.test-support';

let dispose: (() => void) | null = null;
afterEach(() => dispose?.());
function harness(...args: Parameters<typeof makeHarness>) {
  const h = makeHarness(...args);
  dispose = h.dispose;
  return h;
}
const posts = (h: ReturnType<typeof makeHarness>) =>
  h.mock.calls.filter((c) => c.method === 'POST');

describe('setupScenario (mutation mode)', () => {
  it('creates the QA customer, a goal wallet and funds main; proves ownership of both wallets', async () => {
    const h = harness();
    await setupScenario(h.ctx);
    const { state } = h;
    expect(state.customerId).not.toBeNull();
    expect(state.mainWalletId).toBe(state.createdWalletId);
    expect(state.mainWalletBasis).toBe('create_response');
    expect(state.goalWalletId).not.toBeNull();
    expect(state.authorized.size).toBe(2);
    expect(state.wallets.map((w) => w.role).sort()).toEqual(['goal', 'main']);
    expect(posts(h).map((c) => c.pathname)).toEqual([
      '/api/v1/customers',
      '/api/v1/wallet/sub-account',
      '/api/v1/transfer/test/funding',
    ]);
  });

  it('on a re-run resumes journaled slots, resends nothing, and finds the customer by identifier', async () => {
    const journal = createMemoryJournal();
    const first = harness({ journal });
    await setupScenario(first.ctx);
    const sandbox = first.mock.sandbox;
    first.dispose();

    const second = harness({ journal, runId: 'run2' });
    // Same provider state, new process: reuse the first mock's sandbox.
    second.mock.sandbox.customers = sandbox.customers;
    second.mock.sandbox.wallets = sandbox.wallets;
    await setupScenario(second.ctx);
    expect(posts(second)).toHaveLength(0);
    expect(second.state.customerId).not.toBeNull();
    expect(second.state.createdWalletId).toBeNull();
    expect(second.state.mainWalletBasis).toBe('earliest_created_heuristic');
    expect(second.state.goalWalletId).not.toBeNull();
    expect(second.state.notes.join(' ')).toMatch(/resumed/);
  });

  it('does not claim a goal wallet when its creation outcome is unknown and nothing is listed', async () => {
    const h = harness({ mock: { failNetworkOnce: ['/wallet/sub-account'] } });
    await setupScenario(h.ctx);
    expect(h.state.goalWalletId).toBeNull();
    expect(h.state.notes.join(' ')).toMatch(/goal wallet/);
  });
});

describe('setupScenario (read-only)', () => {
  it('sends no POST and reports a missing QA customer honestly', async () => {
    const h = harness({ mode: 'live-readonly' });
    await setupScenario(h.ctx);
    expect(posts(h)).toHaveLength(0);
    expect(h.state.customerId).toBeNull();
    expect(h.state.notes.join(' ')).toMatch(/not found/);
  });
});

describe('setupScenario: ground truth for the default wallet', () => {
  it('uses the create response as ground truth only when the customer is brand new', async () => {
    const first = harness();
    await setupScenario(first.ctx);
    expect(first.state.createdNewCustomer).toBe(true);
    expect(first.state.createdWalletId).not.toBeNull();
    const { customers, wallets } = first.mock.sandbox;
    first.dispose();

    // A different journal: the create call runs again but the customer exists.
    const second = harness({ journal: createMemoryJournal(), runId: 'run2' });
    second.mock.sandbox.customers = customers;
    second.mock.sandbox.wallets = wallets;
    await setupScenario(second.ctx);
    expect(second.state.createdNewCustomer).toBe(false);
    expect(second.state.createdWalletId).toBeNull();
    expect(second.state.mainWalletBasis).toBe('earliest_created_heuristic');
  });
});

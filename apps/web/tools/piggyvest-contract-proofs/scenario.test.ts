import { afterEach, describe, expect, it } from 'vitest';
import { FUNDING_FLOOR_KOBO } from './constants';
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

describe('setupScenario: the funding floor covers every planned outflow', () => {
  async function topUpCase(startingBalance: number) {
    const first = harness();
    await setupScenario(first.ctx);
    const { customers, wallets } = first.mock.sandbox;
    const main = wallets.find((w) => w.id === first.state.mainWalletId);
    if (!main) throw new Error('main wallet missing');
    main.balance = startingBalance; // an existing QA main wallet
    first.dispose();

    const h = harness({
      journal: createMemoryJournal(),
      attempt: 2,
      runId: 'run2',
    });
    h.mock.sandbox.customers = customers;
    h.mock.sandbox.wallets = wallets;
    await setupScenario(h.ctx);
    return { h, main };
  }
  const fundingPosts = (h: ReturnType<typeof makeHarness>) =>
    posts(h).filter((c) => c.pathname === '/api/v1/transfer/test/funding');

  it('tops up a main wallet holding exactly the old floor of 3 transfers (no room for the bank fee)', async () => {
    const { h, main } = await topUpCase(300_000);
    expect(fundingPosts(h)).toHaveLength(1);
    expect(main.balance).toBeGreaterThanOrEqual(FUNDING_FLOOR_KOBO);
  });

  it('tops up a wallet one kobo under the floor, and leaves one at the floor alone', async () => {
    const under = await topUpCase(FUNDING_FLOOR_KOBO - 1);
    expect(fundingPosts(under.h)).toHaveLength(1);
    under.h.dispose();
    const at = await topUpCase(FUNDING_FLOOR_KOBO);
    expect(fundingPosts(at.h)).toHaveLength(0);
  });

  it('leaves the wallet un-funded and says why when its balance cannot be read', async () => {
    const h = harness();
    const original = h.api.wallet.bind(h.api);
    // Ownership checks work; only the funding-floor balance read (made once the
    // goal wallet is known) fails.
    h.api.wallet = async (walletId) =>
      h.state.goalWalletId
        ? {
            ...(await original(walletId)),
            ok: false,
            httpStatus: 503,
            data: undefined,
          }
        : original(walletId);
    await setupScenario(h.ctx);
    expect(fundingPosts(h)).toHaveLength(0);
    expect(h.state.notes.join(' ')).toMatch(/balance could not be read/);
  });
});

describe('setupScenario: re-listing after an uncertain goal wallet creation uses the polling budget', () => {
  it('lists the customer wallets once per allowed poll before giving up', async () => {
    const h = harness({
      maxPolls: 5,
      mock: { failNetworkOnce: ['/wallet/sub-account'] },
    });
    await setupScenario(h.ctx);
    const listCalls = h.mock.calls.filter(
      (c) => c.pathname === '/api/v1/wallet/api/wallet-type'
    );
    expect(h.state.goalWalletId).toBeNull();
    expect(listCalls).toHaveLength(1 + 5);
  });
});

describe('setupScenario: a failed read that kept data is not a measurement', () => {
  const fundingPosts = (h: ReturnType<typeof makeHarness>) =>
    h.mock.calls.filter((c) => c.pathname === '/api/v1/transfer/test/funding');
  it('does not fund, or load wallets, from a 503 that kept a plausible body', async () => {
    const h = harness();
    const original = h.api.wallet.bind(h.api);
    h.api.wallet = async (walletId) =>
      h.state.goalWalletId
        ? {
            ...(await original(walletId)),
            ok: false,
            httpStatus: 503,
            data: { id: walletId, balance: 0, withdrawal_count: 0 },
          }
        : original(walletId);
    await setupScenario(h.ctx);
    expect(fundingPosts(h)).toHaveLength(0);
    expect(h.state.notes.join(' ')).toMatch(/balance could not be read/);
  });

  it('ignores a customer wallet list that came back as a failure but kept its rows', async () => {
    const h = harness();
    const original = h.api.customerWallets.bind(h.api);
    h.api.customerWallets = async (customerId, order) => ({
      ...(await original(customerId, order)),
      ok: false,
      httpStatus: 503,
    });
    await setupScenario(h.ctx);
    expect(h.state.wallets).toEqual([]);
    expect(h.state.notes.join(' ')).toMatch(/wallet list could not be read/);
  });

  it('does not take a wallet creation date from a failed read that kept one', async () => {
    const h = harness({ mock: { walletListIncludesCreatedAt: false } });
    await setupScenario(h.ctx);
    h.state.wallets = [];
    h.state.authorized.clear();
    const original = h.api.wallet.bind(h.api);
    h.api.wallet = async (walletId) => ({
      ...(await original(walletId)),
      ok: false,
      httpStatus: 503,
      data: { id: walletId, balance: 0, created_at: '2000-01-01' },
    });
    await setupScenario(h.ctx);
    const created = h.state.wallets.find(
      (wallet) => wallet.id === h.state.createdWalletId
    );
    expect(created).toBeDefined();
    expect(created?.createdAt ?? null).toBeNull();
  });
});

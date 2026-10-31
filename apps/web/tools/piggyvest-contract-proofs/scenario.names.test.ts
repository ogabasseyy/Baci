import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryJournal } from './mutation-journal';
import { runGoalVariant } from './proof-7-goal-variants';
import { setupScenario } from './scenario';
import { makeHarness } from './test-harness.test-support';

/**
 * The live sandbox listed the QA goal wallet back with every `-` removed
 * (2026-10-31), so an exact name lookup never found it and proofs 2, 3, 4
 * and 6 had no goal wallet. The mock now rewrites names the same way.
 */

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

/** A second QA-owned wallet whose name also reads as the goal name. */
function addLookalikeGoal(h: ReturnType<typeof makeHarness>, name: string) {
  const customerId = h.state.customerId ?? '';
  const [template] = h.mock.sandbox.wallets;
  h.mock.sandbox.wallets.push({
    ...template,
    id: '01M2TLOOKALIKE0000000000AA',
    customerId,
    name,
    createdAt: '2026-10-30T09:00:00.000Z',
    balance: 0,
    account: '9099999999',
  });
}

describe('bugfix: setupScenario finds a goal wallet the sandbox renamed', () => {
  it('assigns the goal role to the wallet listed under the rewritten name', async () => {
    const h = harness();
    await setupScenario(h.ctx);
    const goal = h.mock.sandbox.wallets.find(
      (w) => w.id === h.state.goalWalletId
    );
    expect(goal?.name).toBe(h.ctx.qa.goalWalletName.replaceAll('-', ''));
    expect(h.state.wallets.map((w) => w.role).sort()).toEqual(['goal', 'main']);
    expect(posts(h)).toEqual([
      '/api/v1/customers',
      '/api/v1/wallet/sub-account',
      '/api/v1/transfer/test/funding',
    ]);
  });

  it('refuses to choose between two QA wallets that both read as the goal, and creates no other', async () => {
    const journal = createMemoryJournal();
    const first = harness({ journal });
    await setupScenario(first.ctx);
    addLookalikeGoal(first, first.ctx.qa.goalWalletName.toUpperCase());
    const { customers, wallets } = first.mock.sandbox;

    const second = harness({ journal: createMemoryJournal(), runId: 'run2' });
    second.mock.sandbox.customers = customers;
    second.mock.sandbox.wallets = wallets;
    await setupScenario(second.ctx);

    expect(second.state.goalWalletId).toBeNull();
    expect(posts(second)).not.toContain('/api/v1/wallet/sub-account');
    expect(second.state.notes.join(' ')).toMatch(/more than one/i);
    // Neither look-alike may stand in for the main wallet either.
    const main = wallets.find((w) => w.id === second.state.mainWalletId);
    expect(main?.id).toBe(customers[0].defaultWalletId);
  });

  it('keeps the rewritten goal name out of evidence text', async () => {
    const h = harness();
    await setupScenario(h.ctx);
    const rewritten = h.ctx.qa.goalWalletName.replaceAll('-', '');
    expect(h.redactor.text(`listed as ${rewritten}`)).not.toContain(rewritten);
  });
});

describe('bugfix: proof 7 finds a resumed goal variant the sandbox renamed', () => {
  const unset = {
    slot: 'v/unset',
    nameSuffix: '-vunset',
    payoutWalletId: null,
  };

  it('treats two wallets that both read as the variant name as not found', async () => {
    const journal = createMemoryJournal();
    const first = harness({ journal });
    await setupScenario(first.ctx);
    const owner = {
      qa: first.ctx.qa,
      customerId: first.state.customerId ?? '',
    };
    await runGoalVariant(
      first.ctx,
      owner,
      first.mock.sandbox.businessWalletId,
      unset
    );
    addLookalikeGoal(
      first,
      `${first.ctx.qa.goalWalletName}-vunset`.toUpperCase()
    );
    const { customers, wallets } = first.mock.sandbox;

    const h = harness({ journal, runId: 'run2' });
    h.mock.sandbox.customers = customers;
    h.mock.sandbox.wallets = wallets;
    await setupScenario(h.ctx);
    const result = await runGoalVariant(
      h.ctx,
      { qa: h.ctx.qa, customerId: h.state.customerId ?? '' },
      h.mock.sandbox.businessWalletId,
      unset
    );
    expect(result).toMatchObject({
      resumedOutcome: 'accepted',
      exists: null,
      readback: null,
    });
  });
});

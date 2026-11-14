import { afterEach, describe, expect, it } from 'vitest';
import { goalWalletName } from './goal-wallet-names';
import { makeHarness } from './test-harness.test-support';

let dispose: (() => void) | null = null;
afterEach(() => dispose?.());

async function withCustomer() {
  const h = makeHarness();
  dispose = h.dispose;
  await h.api.createCustomer(h.ctx.qa, 't/create');
  return { h, customerId: h.mock.sandbox.customers[0].id };
}
const goals = (h: ReturnType<typeof makeHarness>) =>
  h.mock.sandbox.wallets.filter((w) => w.name !== 'Default Wallet');

describe('ProviderApi.createGoalWallet options', () => {
  it('defaults to the QA goal name with accrual on', async () => {
    const { h, customerId } = await withCustomer();
    await h.api.createGoalWallet(h.ctx.qa, customerId, 't/goal');
    expect(goals(h)).toMatchObject([
      {
        name: goalWalletName(h.ctx.qa.goalWalletName).replaceAll('-', ''),
        interestEnabled: true,
        payoutWalletId: null,
      },
    ]);
  });

  it('sends the given full name, accrual off and no payout for an opted-out goal', async () => {
    const { h, customerId } = await withCustomer();
    const name = `baci-save-${'a'.repeat(32)}`;
    const sent = await h.api.createGoalWallet(h.ctx.qa, customerId, 't/b', {
      subaccountName: name,
      enableInterestAccrual: false,
    });
    expect(sent).toMatchObject({ kind: 'sent', outcome: 'accepted' });
    expect(goals(h)).toMatchObject([
      { name: name.replaceAll('-', ''), interestEnabled: false },
    ]);
  });

  it('sends an explicit payout wallet', async () => {
    const { h, customerId } = await withCustomer();
    const main = h.mock.sandbox.customers[0].defaultWalletId;
    await h.api.createGoalWallet(h.ctx.qa, customerId, 't/c', {
      subaccountName: `baci-save-${'c'.repeat(32)}`,
      payoutWalletId: main,
    });
    expect(goals(h)[0]).toMatchObject({
      payoutWalletId: main,
      interestEnabled: true,
    });
  });

  it('refuses a name over 50 characters before anything is journaled or sent', async () => {
    const { h, customerId } = await withCustomer();
    const before = h.journal.entries().length;
    await expect(
      h.api.createGoalWallet(h.ctx.qa, customerId, 't/long', {
        subaccountName: 'x'.repeat(51),
      })
    ).rejects.toThrow(/50 characters/);
    expect(h.journal.entries()).toHaveLength(before);
    expect(goals(h)).toEqual([]);
  });

  it('never resends a journaled slot, even with different options', async () => {
    const { h, customerId } = await withCustomer();
    const name = `baci-save-${'d'.repeat(32)}`;
    await h.api.createGoalWallet(h.ctx.qa, customerId, 't/d', {
      subaccountName: name,
    });
    const again = await h.api.createGoalWallet(h.ctx.qa, customerId, 't/d', {
      subaccountName: name,
      enableInterestAccrual: false,
    });
    expect(again).toMatchObject({ kind: 'resumed', priorOutcome: 'accepted' });
    expect(goals(h)).toHaveLength(1);
  });
});

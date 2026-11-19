import { describe, expect, it } from 'vitest';
import { dataOf, type MockCreated } from './mock-reply.test-support';
import { MockSandbox } from './mock-sandbox';

const identity = {
  bvn: '00012345678',
  email: 'synthetic+0123456789ab@example.test',
  name: 'Synthetic Customer',
  phone: '+234000123456',
};

function wallets(options = {}) {
  const sandbox = new MockSandbox(options);
  const created = dataOf<MockCreated>(sandbox.createCustomer(identity, true));
  const goal = dataOf<{ id: string }>(
    sandbox.createWallet({
      subaccount_name: 'goal',
      customer_id: created.customer_id,
    })
  ).id;
  const rate = (id: string) =>
    dataOf<{ current_interest_rate: number }>(sandbox.retrieveWallet(id))
      .current_interest_rate;
  return { main: rate(created.wallet_id), goal: rate(goal) };
}

describe('MockSandbox goal interest rate', () => {
  it('is 0% everywhere by default', () => {
    expect(wallets()).toEqual({ main: 0, goal: 0 });
  });

  it('puts the configured rate on goal wallets only', () => {
    expect(wallets({ goalInterestRate: 0.05 })).toEqual({
      main: 0,
      goal: 0.05,
    });
  });
});

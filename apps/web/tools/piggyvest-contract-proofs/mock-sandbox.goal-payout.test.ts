import { describe, expect, it } from 'vitest';
import { dataOf, type MockCreated } from './mock-reply.test-support';
import { type MockOptions, MockSandbox } from './mock-sandbox';

function withCustomer(options: Partial<MockOptions> = {}) {
  const sandbox = new MockSandbox(options);
  const created = dataOf<MockCreated>(
    sandbox.createCustomer(
      {
        bvn: '00012345678',
        email: 'synthetic+0123456789ab@example.test',
        name: 'Synthetic Customer',
        phone: '+234000123456',
        third_party_identifier: 'pvbproof:qa-1',
        enable_interest_accrual: true,
        interest_payout_wallet: sandbox.businessWalletId,
      },
      true
    )
  );
  return { sandbox, customerId: created.customer_id };
}

function goal(
  options: Partial<MockOptions>,
  body: Record<string, unknown> = {}
) {
  const { sandbox, customerId } = withCustomer(options);
  const created = dataOf<{ id: string }>(
    sandbox.createWallet({
      subaccount_name: `baci-save-${'0'.repeat(32)}`,
      customer_id: customerId,
      enable_interest_accrual: true,
      ...body,
    })
  );
  const read = dataOf<Record<string, unknown>>(
    sandbox.retrieveWallet(created.id)
  );
  return { id: created.id, read, sandbox };
}

describe('MockSandbox: payout of a goal created with none of its own', () => {
  it('reads back null by default', () => {
    expect(goal({}).read.interest_payout_wallet).toBeNull();
  });

  it('reads back the goal itself when configured to pay itself', () => {
    const { id, read } = goal({ subWalletPaysItselfWhenUnset: true });
    expect(read.interest_payout_wallet).toBe(id);
  });

  it('never overrides an explicit payout', () => {
    const sandbox = new MockSandbox();
    const explicit = goal(
      { subWalletPaysItselfWhenUnset: true },
      { interest_payout_wallet: sandbox.businessWalletId }
    );
    expect(explicit.read.interest_payout_wallet).toBe(sandbox.businessWalletId);
  });

  it('records accrual off for an opted-out goal', () => {
    const { read } = goal({}, { enable_interest_accrual: false });
    expect(read.enable_interest_accrual).toBe(false);
  });
});

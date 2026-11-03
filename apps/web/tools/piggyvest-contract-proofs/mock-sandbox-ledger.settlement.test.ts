import { describe, expect, it } from 'vitest';
import { dataOf, type MockCreated } from './mock-reply.test-support';
import { MockSandbox } from './mock-sandbox';

const identity = {
  bvn: '00012345678',
  email: 'synthetic+0123456789ab@example.test',
  name: 'Synthetic Customer',
  phone: '+234000123456',
};
const _message = (reply: { body: unknown }) =>
  (reply.body as { message: string }).message;
const _q = (params: Record<string, string>) => new URLSearchParams(params);

/** A customer with a main and a goal wallet, both usable as transfer endpoints. */
function setup(options = {}) {
  const sandbox = new MockSandbox(options);
  const created = dataOf<MockCreated>(sandbox.createCustomer(identity, true));
  const goal = dataOf<{ id: string }>(
    sandbox.createWallet({
      subaccount_name: 'goal',
      customer_id: created.customer_id,
    })
  ).id;
  return {
    sandbox,
    main: created.wallet_id as string,
    goal: goal as string,
    customerId: created.customer_id as string,
  };
}
const balance = (s: MockSandbox, id: string) =>
  dataOf<{ balance: number }>(s.retrieveWallet(id)).balance;
const _count = (s: MockSandbox, id: string) =>
  dataOf<{ withdrawal_count: number }>(s.retrieveWallet(id)).withdrawal_count;

describe('MockLedger.rowCount', () => {
  it('counts the debit and credit rows a wallet has, including rows hidden by list lag', () => {
    const s = setup({ listLagReads: 5 });
    s.sandbox.ledger.fund({ wallet_id: s.main, amount: 500_000 });
    s.sandbox.ledger.transfer('wallet', {
      amount: 1000,
      source: s.main,
      destination: s.goal,
      reference: 'w2w-1',
    });
    // main: the funding credit and the transfer debit; goal: the transfer credit.
    expect(s.sandbox.ledger.rowCount(s.main)).toBe(2);
    expect(s.sandbox.ledger.rowCount(s.goal)).toBe(1);
    expect(s.sandbox.ledger.rowCount('nobody')).toBe(0);
  });
});

describe('MockLedger tsqSettleEarly', () => {
  it('moves the money at the first status check while TSQ still reports pending', () => {
    const s = setup({ tsqSettleEarly: true, tsqPendingPolls: 3 });
    s.sandbox.ledger.fund({ wallet_id: s.main, amount: 500_000 });
    s.sandbox.ledger.transfer('wallet', {
      amount: 100_000,
      source: s.main,
      destination: s.goal,
      reference: 'early-1',
    });
    const status = () =>
      dataOf<{ status: string }>(
        s.sandbox.ledger.verify(new URLSearchParams({ reference: 'early-1' }))
      ).status;
    expect(balance(s.sandbox, s.goal)).toBe(0);
    expect(status()).toBe('pending');
    expect(balance(s.sandbox, s.goal)).toBe(100_000);
    expect([status(), status(), status()]).toEqual([
      'pending',
      'pending',
      'success',
    ]);
    // settled once only
    expect(balance(s.sandbox, s.goal)).toBe(100_000);
  });
});

describe('MockLedger tsqPendingPollsBank', () => {
  it('lets a bank outflow settle on a different schedule from wallet transfers', () => {
    const s = setup({ tsqPendingPolls: 3, tsqPendingPollsBank: 0 });
    s.sandbox.ledger.fund({ wallet_id: s.main, amount: 500_000 });
    s.sandbox.ledger.transfer('bank', {
      amount: 100_000,
      source: s.main,
      accountNumber: '0123456789',
      bankCode: '058',
      reference: 'bank-x',
    });
    s.sandbox.ledger.transfer('wallet', {
      amount: 1000,
      source: s.main,
      destination: s.goal,
      reference: 'w2w-x',
    });
    const status = (reference: string) =>
      dataOf<{ status: string }>(
        s.sandbox.ledger.verify(new URLSearchParams({ reference }))
      ).status;
    expect(status('bank-x')).toBe('success');
    expect(status('w2w-x')).toBe('pending');
  });
});

import { describe, expect, it } from 'vitest';
import {
  dataOf,
  envelopeOf,
  type MockCreated,
  type MockPage,
  type MockPagedData,
} from './mock-reply.test-support';
import { MockSandbox } from './mock-sandbox';

const identity = {
  bvn: '00012345678',
  email: 'synthetic+0123456789ab@example.test',
  name: 'Synthetic Customer',
  phone: '+234000123456',
  third_party_identifier: 'pvbproof:qa-1',
};
const q = (params: Record<string, string>) => new URLSearchParams(params);

describe('mock house (business) wallet', () => {
  it('is retrievable with no api_customer_id, and never listed as a customer wallet', () => {
    const sandbox = new MockSandbox();
    const created = dataOf<MockCreated>(sandbox.createCustomer(identity, true));
    const house = dataOf(sandbox.retrieveWallet(sandbox.businessWalletId));
    expect(house).toMatchObject({
      id: sandbox.businessWalletId,
      api_customer_id: null,
      balance: 0,
    });
    expect(sandbox.wallets.map((w) => w.id)).not.toContain(
      sandbox.businessWalletId
    );
    const listed = envelopeOf<MockPagedData>(
      sandbox.listWallets(q({ customer_id: created.customer_id }))
    ).data.paginatedPayload.edges;
    expect(listed.map((w) => w.id)).toEqual([created.wallet_id]);
    // A customer's own wallet still names its customer.
    expect(dataOf(sandbox.retrieveWallet(created.wallet_id))).toMatchObject({
      api_customer_id: created.customer_id,
    });
  });

  it('can be funded and used as a transfer source, crediting the destination', () => {
    const sandbox = new MockSandbox({ depositFeeKobo: 0, tsqPendingPolls: 0 });
    const created = dataOf<MockCreated>(sandbox.createCustomer(identity, true));
    sandbox.ledger.fund({
      wallet_id: sandbox.businessWalletId,
      amount: 200_000,
    });
    expect(sandbox.house.balance).toBe(200_000);
    const sent = sandbox.ledger.transfer('wallet', {
      source: sandbox.businessWalletId,
      destination: created.wallet_id,
      amount: 100_000,
      reference: 'pvbproof-house-0001',
    });
    expect(sent.status).toBe(202);
    sandbox.ledger.verify(q({ reference: 'pvbproof-house-0001' }));
    expect(sandbox.house.balance).toBe(100_000);
    const rows = dataOf<MockPage>(
      sandbox.ledger.listTransactions(q({ wallet_id: created.wallet_id }))
    ).edges;
    expect(rows[0]).toMatchObject({
      type: 'credit',
      third_party_reference: 'pvbproof-house-0001',
    });
  });

  it('is carried over when a later sandbox adopts this one', () => {
    const first = new MockSandbox({ depositFeeKobo: 0 });
    first.ledger.fund({ wallet_id: first.businessWalletId, amount: 50_000 });
    const next = new MockSandbox();
    next.adopt(first);
    expect(next.house.balance).toBe(50_000);
  });

  it('lists the house wallet funding account like any other wallet', () => {
    const sandbox = new MockSandbox();
    const accounts = dataOf<{ account_number: string }[]>(
      sandbox.walletAccounts(sandbox.businessWalletId)
    );
    expect(accounts[0].account_number).toMatch(/^\d{10}$/);
  });
});

describe('MockSandbox customer matching (BVN collision knob)', () => {
  const sameBvn = {
    ...identity,
    email: 'synthetic+ba5e00000000@example.test',
    phone: '+234000654321',
    third_party_identifier: 'pvbproof:qa-1:bvnalt',
  };

  it('returns the existing customer for the same BVN under another identifier by default', () => {
    const sandbox = new MockSandbox();
    const first = dataOf<MockCreated>(sandbox.createCustomer(identity, true));
    const again = dataOf<MockCreated>(sandbox.createCustomer(sameBvn, true));
    expect(again).toMatchObject({
      customer_id: first.customer_id,
      new_customer: false,
    });
  });

  it('creates a separate customer when matching is on email only', () => {
    const sandbox = new MockSandbox({ customerMatchOn: 'email_only' });
    const first = dataOf<MockCreated>(sandbox.createCustomer(identity, true));
    const again = dataOf<MockCreated>(sandbox.createCustomer(sameBvn, true));
    expect(again.new_customer).toBe(true);
    expect(again.customer_id).not.toBe(first.customer_id);
    // The same email still finds the original.
    expect(
      dataOf<MockCreated>(sandbox.createCustomer(identity, true)).customer_id
    ).toBe(first.customer_id);
  });
});

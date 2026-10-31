import { describe, expect, it } from 'vitest';
import { MockSandbox } from './mock-sandbox';

const identity = {
  bvn: '00012345678',
  email: 'synthetic+0123456789ab@example.test',
  name: 'Synthetic Customer',
  phone: '+234000123456',
  third_party_identifier: 'pvbproof:a',
};

describe('MockSandbox.adopt', () => {
  it('carries customers and wallets over', () => {
    const first = new MockSandbox();
    first.createCustomer(identity, true);
    const next = new MockSandbox();
    next.adopt(first);
    expect(next.customers).toHaveLength(1);
    expect(next.wallets).toHaveLength(1);
  });

  it('keeps new ids and timestamps from colliding with the adopted ones', () => {
    const first = new MockSandbox();
    first.createCustomer(identity, true);
    const next = new MockSandbox();
    next.adopt(first);
    next.createCustomer(
      {
        ...identity,
        bvn: '00098765432',
        email: 'other@example.test',
        phone: '+234000999999',
        third_party_identifier: 'pvbproof:b',
      },
      true
    );
    const ids = next.customers.map((customer) => customer.id);
    expect(new Set(ids).size).toBe(2);
    const walletIds = next.wallets.map((wallet) => wallet.id);
    expect(new Set(walletIds).size).toBe(2);
    const [older, newer] = next.wallets.map((wallet) => wallet.createdAt);
    expect(newer > older).toBe(true);
  });

  it('never moves a counter backwards', () => {
    const first = new MockSandbox();
    const next = new MockSandbox();
    next.id();
    next.id();
    next.adopt(first);
    expect(next.id()).toBe(3);
  });
});

import { describe, expect, it } from 'vitest';
import { accruedInterestReply } from './mock-accruals';
import {
  dataOf,
  envelopeOf,
  type MockCreated,
  type MockPagedData,
} from './mock-reply.test-support';
import { DEFAULT_MOCK_OPTIONS, MockSandbox } from './mock-sandbox';

/**
 * Behaviour the live sandbox showed on 2026-10-31 that the mock must copy,
 * so the ground-truth oracle exercises it on every seed.
 */

const identity = {
  bvn: '00012345678',
  email: 'synthetic+0123456789ab@example.test',
  name: 'Synthetic Customer',
  phone: '+234000123456',
  third_party_identifier: 'pvbproof:qa-1',
};

function withCustomer() {
  const sandbox = new MockSandbox();
  const created = dataOf<MockCreated>(sandbox.createCustomer(identity, true));
  return { sandbox, created };
}

const listedNames = (sandbox: MockSandbox, customerId: string) =>
  dataOf<MockPagedData>(
    sandbox.listWallets(new URLSearchParams({ customer_id: customerId }))
  ).paginatedPayload.edges.map((edge) => edge.name);

describe('MockSandbox: live sandbox name rewriting', () => {
  it('lists a new sub-wallet under its name with every hyphen removed', () => {
    const { sandbox, created } = withCustomer();
    const reply = sandbox.createWallet({
      subaccount_name: 'pvbproof-goal-baciqa-proof-20261031',
      customer_id: created.customer_id,
    });
    const id = dataOf<{ id: string }>(reply).id;
    expect(listedNames(sandbox, created.customer_id)).toContain(
      'pvbproofgoalbaciqaproof20261031'
    );
    expect(dataOf<{ name: string }>(sandbox.retrieveWallet(id)).name).toBe(
      'pvbproofgoalbaciqaproof20261031'
    );
  });

  it('answers sub-wallet creation with HTTP 202, as the live sandbox did', () => {
    const { sandbox, created } = withCustomer();
    const reply = sandbox.createWallet({
      subaccount_name: 'goal-1',
      customer_id: created.customer_id,
    });
    expect(reply.status).toBe(202);
    expect(envelopeOf(reply).status).toBe(true);
  });

  it('refuses a second wallet whose name differs only by hyphens', () => {
    const { sandbox, created } = withCustomer();
    sandbox.createWallet({
      subaccount_name: 'goal-1',
      customer_id: created.customer_id,
    });
    expect(
      sandbox.createWallet({
        subaccount_name: 'goal1',
        customer_id: created.customer_id,
      }).status
    ).toBe(400);
  });
});

describe('MockSandbox: live accrual page info', () => {
  it('sends hasNextPage and endCursor only, with no previousCursor', () => {
    const reply = accruedInterestReply(
      DEFAULT_MOCK_OPTIONS,
      'w1',
      new URLSearchParams()
    );
    expect(dataOf<MockPagedData>(reply).paginatedPayload.pageInfo).toEqual({
      hasNextPage: false,
      endCursor: null,
    });
  });
});

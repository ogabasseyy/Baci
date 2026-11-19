import { describe, expect, it } from 'vitest';
import {
  envelopeOf,
  type MockCreated,
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
const body = envelopeOf;
const _paged = (reply: { body: unknown }) =>
  envelopeOf<MockPagedData>(reply).data.paginatedPayload.edges;

function withCustomer(options = {}) {
  const sandbox = new MockSandbox(options);
  const created = body<MockCreated>(
    sandbox.createCustomer(identity, true)
  ).data;
  return { sandbox, created };
}

describe('MockSandbox readback modes', () => {
  const fieldsOf = (options: object) => {
    const { sandbox, created } = withCustomer(options);
    return body(sandbox.retrieveWallet(created.wallet_id)).data;
  };
  it("'fields' shows accrual and payout; 'accrual_only' drops the payout; 'none' drops both", () => {
    expect(fieldsOf({ payoutReadback: 'fields' })).toHaveProperty(
      'interest_payout_wallet'
    );
    const accrualOnly = fieldsOf({ payoutReadback: 'accrual_only' });
    expect(accrualOnly).toHaveProperty('enable_interest_accrual');
    expect(accrualOnly).not.toHaveProperty('interest_payout_wallet');
    const none = fieldsOf({ payoutReadback: 'none' });
    expect(none).not.toHaveProperty('enable_interest_accrual');
  });

  it('hides settings for the configured number of readbacks', () => {
    const { sandbox, created } = withCustomer({ settingsLagReads: 2 });
    const has = () =>
      'enable_interest_accrual' in
      body(sandbox.retrieveWallet(created.wallet_id)).data;
    expect([has(), has(), has()]).toEqual([false, false, true]);
  });

  it('drops the payout field on sub-wallets only when asked, keeping it on the main wallet', () => {
    const { sandbox, created } = withCustomer({
      goalReadbackOmitsPayout: true,
    });
    const goal = body<{ id: string }>(
      sandbox.createWallet({
        subaccount_name: 'g',
        customer_id: created.customer_id,
      })
    ).data.id;
    expect(body(sandbox.retrieveWallet(created.wallet_id)).data).toHaveProperty(
      'interest_payout_wallet'
    );
    expect(body(sandbox.retrieveWallet(goal)).data).not.toHaveProperty(
      'interest_payout_wallet'
    );
  });
});

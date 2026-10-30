import { describe, expect, it } from 'vitest';
import { MockSandbox } from './mock-sandbox';

const identity = {
  bvn: '00012345678',
  email: 'synthetic+0123456789ab@example.test',
  name: 'Synthetic Customer',
  phone: '+234000123456',
  third_party_identifier: 'pvbproof:qa-1',
};
const body = (reply: { body: unknown }) =>
  reply.body as { status: boolean; message: string; data: any };
const paged = (reply: { body: unknown }) =>
  body(reply).data.paginatedPayload.edges as Record<string, unknown>[];

function withCustomer(options = {}) {
  const sandbox = new MockSandbox(options);
  const created = body(sandbox.createCustomer(identity, true)).data;
  return { sandbox, created };
}

describe('MockSandbox.createCustomer', () => {
  it('creates a customer with a default wallet and reports new_customer:true', () => {
    const { sandbox, created } = withCustomer();
    expect(created).toMatchObject({ new_customer: true });
    expect(sandbox.customers).toHaveLength(1);
    expect(sandbox.wallets).toHaveLength(1);
    expect(sandbox.customers[0].defaultWalletId).toBe(created.wallet_id);
  });

  it('returns the same customer and default wallet for an existing one, with new_customer:false', () => {
    const { sandbox, created } = withCustomer();
    const again = body(sandbox.createCustomer(identity, true)).data;
    expect(again).toMatchObject({
      customer_id: created.customer_id,
      wallet_id: created.wallet_id,
      new_customer: false,
    });
    expect(sandbox.customers).toHaveLength(1);
  });

  it('declines an existing customer when returnIfExist is not set', () => {
    const { sandbox } = withCustomer();
    expect(sandbox.createCustomer(identity, false).status).toBe(400);
  });

  it('can be told to answer a re-POST with the newest wallet instead of the default', () => {
    const { sandbox, created } = withCustomer({
      repostReturnsOriginalDefault: false,
    });
    sandbox.createWallet({
      subaccount_name: 'goal',
      customer_id: created.customer_id,
    });
    const again = body(sandbox.createCustomer(identity, true)).data;
    expect(again.wallet_id).not.toBe(created.wallet_id);
  });

  it('echoes the third_party_identifier only when configured to', () => {
    expect(withCustomer().created).not.toHaveProperty('third_party_identifier');
    expect(
      withCustomer({ echoThirdPartyIdentifierOnCreate: true }).created
        .third_party_identifier
    ).toBe('pvbproof:qa-1');
  });

  it('accepts a payout wallet that exists (the business wallet or a known wallet) and stores it', () => {
    const sandbox = new MockSandbox();
    const reply = sandbox.createCustomer(
      {
        ...identity,
        interest_payout_wallet: sandbox.businessWalletId,
        enable_interest_accrual: true,
      },
      true
    );
    expect(reply.status).toBe(200);
    expect(sandbox.customers[0].payoutWalletId).toBe(sandbox.businessWalletId);
    expect(sandbox.wallets[0]).toMatchObject({
      payoutWalletId: sandbox.businessWalletId,
      interestEnabled: true,
    });
  });

  it('rejects an unknown payout wallet, and any payout wallet when configured to reject', () => {
    const sandbox = new MockSandbox();
    expect(
      sandbox.createCustomer(
        { ...identity, interest_payout_wallet: 'no-such-wallet' },
        true
      )
    ).toMatchObject({ status: 400 });
    const strict = new MockSandbox({ customerPayoutWallet: 'rejected' });
    const reply = strict.createCustomer(
      { ...identity, interest_payout_wallet: strict.businessWalletId },
      true
    );
    expect(body(reply).message).toBe('Invalid interest payout wallet');
    expect(strict.customers).toHaveLength(0);
  });
});

describe('MockSandbox.listCustomers', () => {
  it('filters by third_party_identifier and customer_id', () => {
    const { sandbox, created } = withCustomer();
    const byTpi = sandbox.listCustomers(
      new URLSearchParams({ third_party_identifier: 'pvbproof:qa-1' })
    );
    expect(paged(byTpi)).toHaveLength(1);
    expect(
      paged(
        sandbox.listCustomers(
          new URLSearchParams({ third_party_identifier: 'other' })
        )
      )
    ).toHaveLength(0);
    expect(
      paged(
        sandbox.listCustomers(
          new URLSearchParams({ customer_id: created.customer_id })
        )
      )
    ).toHaveLength(1);
  });

  it.each([
    ['paginatedPayload', (d: any) => d.paginatedPayload.edges],
    ['edges', (d: any) => d.edges],
    ['array', (d: any) => d],
  ] as const)('puts the rows in the %s container when configured', (container, rows) => {
    const { sandbox } = withCustomer({ customerListContainer: container });
    expect(
      rows(body(sandbox.listCustomers(new URLSearchParams())).data)
    ).toHaveLength(1);
  });

  it('omits the identifier from rows when configured to', () => {
    const { sandbox } = withCustomer({ customerListEchoesIdentifier: false });
    expect(
      paged(sandbox.listCustomers(new URLSearchParams()))[0]
    ).not.toHaveProperty('third_party_identifier');
  });
});

describe('MockSandbox wallets', () => {
  it('creates a sub-wallet for a known customer and refuses duplicates and unknown customers', () => {
    const { sandbox, created } = withCustomer();
    const first = sandbox.createWallet({
      subaccount_name: 'goal',
      customer_id: created.customer_id,
    });
    expect(body(first).data.id).toBeTruthy();
    expect(
      sandbox.createWallet({
        subaccount_name: 'goal',
        customer_id: created.customer_id,
      }).status
    ).toBe(400);
    expect(
      sandbox.createWallet({ subaccount_name: 'x', customer_id: 'nobody' })
        .status
    ).toBe(400);
  });

  it('accepts or rejects a payout wallet on a sub-wallet, and can pass the customer payout down', () => {
    const sandbox = new MockSandbox({ subWalletInheritsPayout: true });
    const created = body(
      sandbox.createCustomer(
        { ...identity, interest_payout_wallet: sandbox.businessWalletId },
        true
      )
    ).data;
    const inherited = body(
      sandbox.createWallet({
        subaccount_name: 'g1',
        customer_id: created.customer_id,
      })
    ).data.id;
    expect(sandbox.wallet(inherited)?.payoutWalletId).toBe(
      sandbox.businessWalletId
    );
    const strict = new MockSandbox({ subAccountAcceptsPayout: false });
    const c = body(strict.createCustomer(identity, true)).data;
    expect(
      body(
        strict.createWallet({
          subaccount_name: 'g',
          customer_id: c.customer_id,
          interest_payout_wallet: strict.businessWalletId,
        })
      ).message
    ).toBe('Invalid interest payout wallet');
  });

  it('lists wallets newest-first by default and oldest-first for ASC, filtered by customer', () => {
    const { sandbox, created } = withCustomer();
    sandbox.createWallet({
      subaccount_name: 'goal',
      customer_id: created.customer_id,
    });
    const desc = paged(
      sandbox.listWallets(
        new URLSearchParams({ customer_id: created.customer_id })
      )
    );
    const asc = paged(
      sandbox.listWallets(
        new URLSearchParams({
          customer_id: created.customer_id,
          orderBy: 'ASC',
        })
      )
    );
    expect(desc.map((w) => w.id)).toEqual([...asc.map((w) => w.id)].reverse());
    expect(asc[0].id).toBe(created.wallet_id);
    expect(
      paged(sandbox.listWallets(new URLSearchParams({ customer_id: 'nobody' })))
    ).toHaveLength(0);
  });

  it('can leave created_at off wallet rows, or add the customer id', () => {
    const a = withCustomer({ walletListIncludesCreatedAt: false });
    expect(
      paged(a.sandbox.listWallets(new URLSearchParams()))[0]
    ).not.toHaveProperty('created_at');
    const b = withCustomer({ walletListIncludesCustomerId: true });
    expect(
      paged(b.sandbox.listWallets(new URLSearchParams()))[0]
    ).toHaveProperty('api_customer_id');
  });

  it('retrieves a wallet with the documented fields, or declines an unknown one', () => {
    const { sandbox, created } = withCustomer();
    const data = body(sandbox.retrieveWallet(created.wallet_id)).data;
    expect(data).toMatchObject({
      id: created.wallet_id,
      api_customer_id: created.customer_id,
      currency: 'NGN',
      withdrawal_count: 0,
      balance: 0,
    });
    expect(sandbox.retrieveWallet('missing').status).toBe(400);
  });

  it('lists a wallet funding account, or declines an unknown wallet', () => {
    const { sandbox, created } = withCustomer();
    const accounts = body(sandbox.walletAccounts(created.wallet_id)).data;
    expect(accounts).toHaveLength(1);
    expect(accounts[0].account_number).toMatch(/^\d{10}$/);
    expect(sandbox.walletAccounts('missing').status).toBe(400);
  });
});

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
    const goal = body(
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

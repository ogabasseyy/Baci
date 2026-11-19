import { describe, expect, it } from 'vitest';
import {
  dataOf,
  type MockCreated,
  type MockPage,
} from './mock-reply.test-support';
import { MockSandbox } from './mock-sandbox';

const identity = {
  bvn: '00012345678',
  email: 'synthetic+0123456789ab@example.test',
  name: 'Synthetic Customer',
  phone: '+234000123456',
};
const message = (reply: { body: unknown }) =>
  (reply.body as { message: string }).message;
const q = (params: Record<string, string>) => new URLSearchParams(params);

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
const count = (s: MockSandbox, id: string) =>
  dataOf<{ withdrawal_count: number }>(s.retrieveWallet(id)).withdrawal_count;

describe('MockLedger.fund', () => {
  it('credits the wallet net of the deposit fee and lists an inflow row', () => {
    const { sandbox, main } = setup();
    expect(
      sandbox.ledger.fund({ wallet_id: main, amount: 200_000 }).status
    ).toBe(200);
    expect(balance(sandbox, main)).toBe(195_000);
    const rows = dataOf<MockPage>(
      sandbox.ledger.listTransactions(q({ wallet_id: main }))
    ).edges;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'credit',
      category: 'inflow_transaction',
      amount: 200_000,
    });
  });

  it('credits the gross when the fee is not taken from the wallet', () => {
    const { sandbox, main } = setup({ depositFeeBorneByWallet: false });
    sandbox.ledger.fund({ wallet_id: main, amount: 200_000 });
    expect(balance(sandbox, main)).toBe(200_000);
  });

  it.each([
    ['an unknown wallet', { wallet_id: 'missing', amount: 1000 }],
    ['a zero amount', { wallet_id: 'main', amount: 0 }],
    ['a fractional amount', { wallet_id: 'main', amount: 1.5 }],
    [
      'an amount over the test-mode cap',
      { wallet_id: 'main', amount: 10_000_001 },
    ],
  ])('declines %s', (_name, request) => {
    const { sandbox, main } = setup();
    const walletId = request.wallet_id === 'main' ? main : request.wallet_id;
    expect(
      sandbox.ledger.fund({ wallet_id: walletId, amount: request.amount })
        .status
    ).toBe(400);
  });

  it('answers "processing" but never credits when settlement is switched off', () => {
    const { sandbox, main } = setup({ fundingSettles: false });
    const reply = sandbox.ledger.fund({ wallet_id: main, amount: 200_000 });
    expect(message(reply)).toBe('Funding Processing');
    expect(balance(sandbox, main)).toBe(0);
  });

  it('keeps showing the old balance for the configured number of reads', () => {
    const { sandbox, main } = setup({ balanceLagReads: 2 });
    sandbox.ledger.fund({ wallet_id: main, amount: 200_000 });
    expect([
      balance(sandbox, main),
      balance(sandbox, main),
      balance(sandbox, main),
    ]).toEqual([0, 0, 195_000]);
  });
});

describe('MockLedger.transfer and verify', () => {
  function funded(options = {}) {
    const s = setup(options);
    s.sandbox.ledger.fund({ wallet_id: s.main, amount: 500_000 });
    return s;
  }
  const send = (s: ReturnType<typeof funded>, over: object = {}) =>
    s.sandbox.ledger.transfer('wallet', {
      amount: 100_000,
      source: s.main,
      destination: s.goal,
      reference: 'ref-aaaa',
      ...over,
    });
  const poll = (s: ReturnType<typeof funded>, ref = 'ref-aaaa') =>
    s.sandbox.ledger.verify(q({ reference: ref }));

  it('answers 202 "processing" and moves no money until a TSQ poll settles it', () => {
    const s = funded();
    const reply = send(s);
    expect(reply.status).toBe(202);
    expect(balance(s.sandbox, s.goal)).toBe(0);
    expect(dataOf(poll(s)).status).toBe('pending');
    expect(dataOf(poll(s)).status).toBe('success');
    expect(balance(s.sandbox, s.goal)).toBe(100_000);
    expect(balance(s.sandbox, s.main)).toBe(495_000 - 100_000);
  });

  it('declines duplicates, insufficient funds and unknown wallets, and does not debit', () => {
    const s = funded();
    send(s);
    expect(message(send(s))).toBe('Duplicate reference');
    expect(message(send(s, { reference: 'ref-bbbb', amount: 9_000_000 }))).toBe(
      'Insufficient funds'
    );
    expect(send(s, { reference: 'ref-cccc', source: 'missing' }).status).toBe(
      400
    );
    expect(
      send(s, { reference: 'ref-dddd', destination: 'missing' }).status
    ).toBe(400);
    expect(balance(s.sandbox, s.main)).toBe(495_000);
  });

  it('answers 404 for an unknown reference and for a not-yet-indexed one', () => {
    const s = funded({ tsqNotFoundPolls: 1 });
    expect(poll(s, 'never-sent').status).toBe(404);
    send(s);
    expect(poll(s).status).toBe(404);
    expect(dataOf(poll(s)).status).toBe('pending');
  });

  it('shapes the TSQ record like the docs, or richly with both wallets and the fee', () => {
    const docs = funded();
    send(docs);
    poll(docs);
    expect(Object.keys(dataOf(poll(docs))).sort()).toEqual([
      'amount',
      'bank',
      'created_at',
      'recipient',
      'reference',
      'status',
    ]);
    const rich = funded({ tsqShape: 'rich' });
    send(rich);
    poll(rich);
    expect(dataOf(poll(rich))).toMatchObject({
      currency: 'NGN',
      fee: 0,
      source_wallet: rich.main,
      destination_wallet: rich.goal,
    });
  });

  it('counts a bank outflow as a withdrawal on the source wallet only, and a wallet transfer as none', () => {
    const s = funded();
    send(s);
    poll(s);
    poll(s);
    expect(count(s.sandbox, s.main)).toBe(0);
    s.sandbox.ledger.transfer('bank', {
      amount: 100_000,
      source: s.main,
      accountNumber: '0123456789',
      bankCode: '058',
      reference: 'bank-1',
    });
    poll(s, 'bank-1');
    poll(s, 'bank-1');
    expect(count(s.sandbox, s.main)).toBe(1);
    expect(count(s.sandbox, s.goal)).toBe(0);
  });

  it('moves the counter on every wallet of the customer when the scope is the customer', () => {
    const s = funded({ counterScope: 'customer' });
    s.sandbox.ledger.transfer('bank', {
      amount: 100_000,
      source: s.main,
      accountNumber: '0123456789',
      bankCode: '058',
      reference: 'bank-1',
    });
    poll(s, 'bank-1');
    poll(s, 'bank-1');
    expect([count(s.sandbox, s.main), count(s.sandbox, s.goal)]).toEqual([
      1, 1,
    ]);
  });

  it('lets goal wallets lag differently from the default wallet', () => {
    const s = funded({
      counterScope: 'customer',
      counterLagReads: 0,
      counterLagReadsGoal: 3,
    });
    s.sandbox.ledger.transfer('bank', {
      amount: 100_000,
      source: s.main,
      accountNumber: '0123456789',
      bankCode: '058',
      reference: 'bank-1',
    });
    poll(s, 'bank-1');
    poll(s, 'bank-1');
    expect(count(s.sandbox, s.main)).toBe(1);
    expect([1, 2, 3, 4].map(() => count(s.sandbox, s.goal))).toEqual([
      0, 0, 0, 1,
    ]);
  });

  it('shows a settled counter change only after the configured number of reads', () => {
    const s = funded({ counterLagReads: 2 });
    s.sandbox.ledger.transfer('bank', {
      amount: 100_000,
      source: s.main,
      accountNumber: '0123456789',
      bankCode: '058',
      reference: 'bank-1',
    });
    poll(s, 'bank-1');
    poll(s, 'bank-1');
    expect([
      count(s.sandbox, s.main),
      count(s.sandbox, s.main),
      count(s.sandbox, s.main),
    ]).toEqual([0, 0, 1]);
  });
});

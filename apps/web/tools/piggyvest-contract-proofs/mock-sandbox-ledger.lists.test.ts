import { describe, expect, it } from 'vitest';
import { MockSandbox } from './mock-sandbox';

const identity = {
  bvn: '00012345678',
  email: 'synthetic+0123456789ab@example.test',
  name: 'Synthetic Customer',
  phone: '+234000123456',
};
const data = (reply: { body: unknown }) => (reply.body as { data: any }).data;
const _message = (reply: { body: unknown }) =>
  (reply.body as { message: string }).message;
const q = (params: Record<string, string>) => new URLSearchParams(params);

/** A customer with a main and a goal wallet, both usable as transfer endpoints. */
function setup(options = {}) {
  const sandbox = new MockSandbox(options);
  const created = data(sandbox.createCustomer(identity, true));
  const goal = data(
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
describe('MockLedger.listTransactions and transaction', () => {
  function withRows(n: number, options = {}) {
    const s = setup(options);
    for (let i = 0; i < n; i += 1)
      s.sandbox.ledger.fund({ wallet_id: s.main, amount: 1000 });
    return s;
  }

  it('pages with a cursor and reports whether there is a next page', () => {
    const { sandbox, main } = withRows(3);
    const first = data(
      sandbox.ledger.listTransactions(q({ wallet_id: main, limit: '2' }))
    );
    expect(first.edges).toHaveLength(2);
    expect(first.pageInfo).toMatchObject({
      hasNextPage: true,
      endCursor: '2',
      previousCursor: null,
    });
    const second = data(
      sandbox.ledger.listTransactions(
        q({ wallet_id: main, limit: '2', cursor: '2' })
      )
    );
    expect(second.edges).toHaveLength(1);
    expect(second.pageInfo).toMatchObject({
      hasNextPage: false,
      endCursor: null,
    });
  });

  it('refuses a page size outside 1 to 100', () => {
    const { sandbox } = withRows(1);
    for (const limit of ['0', '101', 'x']) {
      expect(sandbox.ledger.listTransactions(q({ limit })).status).toBe(400);
    }
  });

  it('hides new rows for the configured number of list reads', () => {
    const { sandbox, main } = withRows(1, { listLagReads: 2 });
    const rows = () =>
      data(sandbox.ledger.listTransactions(q({ wallet_id: main }))).edges
        .length;
    expect([rows(), rows(), rows()]).toEqual([0, 0, 1]);
  });

  it('returns a single record with both wallet fields and the fee, or 404', () => {
    const { sandbox, main } = withRows(1);
    const row = data(sandbox.ledger.listTransactions(q({ wallet_id: main })))
      .edges[0];
    expect(data(sandbox.ledger.transaction(row.id))).toMatchObject({
      fee: 5000,
      source_wallet: null,
      destination_wallet: main,
    });
    expect(sandbox.ledger.transaction('missing').status).toBe(404);
  });
});

describe('MockLedger.accruedInterest', () => {
  it('has no accrual records at the default 0% and refuses an oversize page', () => {
    const { sandbox, main } = setup();
    expect(
      data(sandbox.ledger.accruedInterest(main, q({}))).paginatedPayload.edges
    ).toEqual([]);
    expect(
      sandbox.ledger.accruedInterest(main, q({ limit: '101' })).status
    ).toBe(400);
  });

  it('serves the configured records page by page with a cursor', () => {
    const { sandbox, main } = setup({ accruedEdgeCount: 3 });
    const first = data(
      sandbox.ledger.accruedInterest(main, q({ limit: '2' }))
    ).paginatedPayload;
    expect(first.edges).toHaveLength(2);
    expect(first.pageInfo.hasNextPage).toBe(true);
    const last = data(
      sandbox.ledger.accruedInterest(
        main,
        q({ limit: '2', cursor: first.pageInfo.endCursor })
      )
    ).paginatedPayload;
    expect(last.edges).toHaveLength(1);
    expect(last.pageInfo.hasNextPage).toBe(false);
  });
});

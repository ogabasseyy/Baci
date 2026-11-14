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
const q = (params: Record<string, string>) => new URLSearchParams(params);

function funded(options = {}) {
  const sandbox = new MockSandbox({ depositFeeKobo: 0, ...options });
  const created = dataOf<MockCreated>(sandbox.createCustomer(identity, true));
  const goal = dataOf<{ id: string }>(
    sandbox.createWallet({
      subaccount_name: 'goal',
      customer_id: created.customer_id,
    })
  ).id;
  sandbox.ledger.fund({ wallet_id: created.wallet_id, amount: 500_000 });
  return { sandbox, main: created.wallet_id, goal };
}
const transfer = (s: ReturnType<typeof funded>) =>
  s.sandbox.ledger.transfer('wallet', {
    source: s.main,
    destination: s.goal,
    amount: 100_000,
    reference: 'pvbproof-dup-0001',
  });
const settle = (s: ReturnType<typeof funded>) => {
  for (let i = 0; i < 4; i += 1)
    s.sandbox.ledger.verify(q({ reference: 'pvbproof-dup-0001' }));
};
const debitRows = (s: ReturnType<typeof funded>) =>
  dataOf<MockPage>(
    s.sandbox.ledger.listTransactions(q({ wallet_id: s.main }))
  ).edges.filter((row) => row.third_party_reference === 'pvbproof-dup-0001');

describe('MockLedger duplicate references', () => {
  it('refuses a repeated reference by default and moves nothing', () => {
    const s = funded();
    transfer(s);
    settle(s);
    expect(transfer(s).status).toBe(400);
    settle(s);
    expect(s.sandbox.wallet(s.main)?.balance).toBe(400_000);
    expect(debitRows(s)).toHaveLength(1);
  });

  it('books the repeat as a second transfer when told to accept it, settling on the next status check', () => {
    const s = funded({ duplicateReference: 'accept' });
    transfer(s);
    settle(s);
    expect(transfer(s).status).toBe(202);
    settle(s);
    expect(s.sandbox.wallet(s.main)?.balance).toBe(300_000);
    expect(debitRows(s)).toHaveLength(2);
  });

  it('names the provider transaction id in the rich TSQ shape', () => {
    const s = funded({ tsqShape: 'rich', tsqPendingPolls: 0 });
    transfer(s);
    const tsq = dataOf<{ id: string }>(
      s.sandbox.ledger.verify(q({ reference: 'pvbproof-dup-0001' }))
    );
    expect(tsq.id).toBe(debitRows(s)[0]?.id);
  });
});

describe('MockLedger accepted repeats follow the pending/404 progression', () => {
  const balance = (s: ReturnType<typeof funded>) =>
    s.sandbox.wallet(s.main)?.balance;
  const check = (s: ReturnType<typeof funded>) =>
    s.sandbox.ledger.verify(q({ reference: 'pvbproof-dup-0001' }));

  it('does not move the repeat money while the original is still pending', () => {
    const s = funded({
      duplicateReference: 'accept',
      tsqNotFoundPolls: 0,
      tsqPendingPolls: 3,
    });
    transfer(s);
    transfer(s);
    expect(balance(s)).toBe(500_000);
    check(s);
    check(s);
    check(s);
    expect(balance(s)).toBe(500_000);
    check(s);
    expect(balance(s)).toBe(300_000);
  });

  it('keeps answering 404 for the reference until the not-found polls pass', () => {
    const s = funded({
      duplicateReference: 'accept',
      tsqNotFoundPolls: 2,
      tsqPendingPolls: 0,
    });
    transfer(s);
    transfer(s);
    expect(check(s).status).toBe(404);
    expect(check(s).status).toBe(404);
    expect(balance(s)).toBe(500_000);
    expect(check(s).status).toBe(200);
    expect(balance(s)).toBe(300_000);
  });
});

describe('MockLedger TSQ with an accepted repeat (first-booking semantics)', () => {
  const check = (s: ReturnType<typeof funded>) =>
    dataOf<{ id: string; status: string }>(
      s.sandbox.ledger.verify(q({ reference: 'pvbproof-dup-0001' }))
    );

  it('always describes the first booking, while the repeat settles on its own record', () => {
    const s = funded({
      duplicateReference: 'accept',
      tsqShape: 'rich',
      tsqNotFoundPolls: 0,
      tsqPendingPolls: 1,
    });
    transfer(s);
    transfer(s);
    const [repeat, original] = debitRows(s); // newest first
    expect(original?.id).not.toBe(repeat?.id);
    const pending = check(s);
    expect(pending).toMatchObject({ id: original?.id, status: 'pending' });
    const settled = check(s);
    expect(settled).toMatchObject({ id: original?.id, status: 'success' });
    // The repeat's own record settled even though TSQ never named it.
    expect(debitRows(s).map((row) => row.status)).toEqual([
      'successful',
      'successful',
    ]);
  });
});

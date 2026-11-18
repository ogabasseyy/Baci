import { readImeiLookupStatuses } from './imei-lookup-statuses';

const calls: unknown[][] = [];
jest.mock('@/lib/supabase', () => {
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      return query;
    };
  const query: Record<string, unknown> = {
    select: record('select'),
    eq: record('eq'),
    in: record('in'),
    limit: async () => ({
      data: [{ id: 'l1', status: 'pending' }],
      error: null,
    }),
  };
  return { supabase: { from: () => query } };
});

describe('readImeiLookupStatuses', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('bugfix: filters by the customer as well as the store (Muse)', async () => {
    await readImeiLookupStatuses('merchant-1', 'customer-1')(['l1']);
    expect(calls).toEqual([
      ['select', 'id, status'],
      ['eq', 'merchant_id', 'merchant-1'],
      ['eq', 'customer_id', 'customer-1'],
      ['in', 'id', ['l1']],
    ]);
  });

  it('reads nothing without a customer', async () => {
    await expect(
      readImeiLookupStatuses('merchant-1', null)(['l1'])
    ).resolves.toEqual({ data: [], error: null });
    expect(calls).toEqual([]);
  });
});

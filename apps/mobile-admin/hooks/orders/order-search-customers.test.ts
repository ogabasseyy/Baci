import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => {
  const calls: Array<{ args: unknown[]; method: string }> = [];
  let result: { data: unknown; error: { message: string } | null } = {
    data: [],
    error: null,
  };
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  for (const method of ['select', 'eq', 'or', 'limit']) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  Object.defineProperty(chain, 'then', {
    value: (resolve: (value: typeof result) => unknown) =>
      Promise.resolve(result).then(resolve),
  });
  return {
    calls,
    from: vi.fn((table: string) => {
      calls.push({ method: 'from', args: [table] });
      return chain;
    }),
    reset: () => {
      calls.length = 0;
      result = { data: [], error: null };
    },
    setResult: (next: typeof result) => {
      result = next;
    },
  };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from: supabaseMock.from } }));

import {
  findCustomerIdsMatchingSearch,
  MAX_MATCHED_CUSTOMER_IDS,
} from './order-search-customers';

describe('findCustomerIdsMatchingSearch', () => {
  beforeEach(() => supabaseMock.reset());

  it('finds the merchant’s customers by profile name, email, or phone', async () => {
    supabaseMock.setResult({
      data: [{ id: 'customer-1' }, { id: 'customer-2' }],
      error: null,
    });

    const ids = await findCustomerIdsMatchingSearch('merchant-1', 'jonathan');

    expect(ids).toEqual(['customer-1', 'customer-2']);
    expect(supabaseMock.calls).toEqual([
      { method: 'from', args: ['customers'] },
      { method: 'select', args: ['id'] },
      { method: 'eq', args: ['merchant_id', 'merchant-1'] },
      {
        method: 'or',
        args: [
          'first_name.ilike."%jonathan%",last_name.ilike."%jonathan%",email.ilike."%jonathan%",phone.ilike."%jonathan%"',
        ],
      },
      { method: 'limit', args: [MAX_MATCHED_CUSTOMER_IDS] },
    ]);
  });

  it('escapes wildcards and quotes so the filter cannot be split', async () => {
    await findCustomerIdsMatchingSearch('merchant-1', 'a_b%, "c"');

    const orCall = supabaseMock.calls.find((call) => call.method === 'or');
    expect(orCall?.args[0]).toContain(
      String.raw`first_name.ilike."%a\\_b\\%, \"c\"%"`
    );
  });

  it('falls back to no profile matches when the lookup fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    supabaseMock.setResult({ data: null, error: { message: 'boom' } });

    await expect(
      findCustomerIdsMatchingSearch('merchant-1', 'jonathan')
    ).resolves.toEqual([]);
    warn.mockRestore();
  });
});

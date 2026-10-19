import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => {
  type QueryResult = {
    data: unknown;
    error: { message: string } | null;
  };
  let orderDetailResult: QueryResult = {
    data: {
      id: 'order-1',
      recorded_by_user_id: 'user-1',
      total: 100,
      wallet_amount_used: 0,
    },
    error: null,
  };
  const tableResults = new Map<string, QueryResult[]>();

  function getTableResult(table: string): QueryResult {
    const results = tableResults.get(table);
    if (!results || results.length === 0) {
      return { data: null, error: null };
    }

    return results.shift() as QueryResult;
  }

  function makeChain(table: string) {
    const chain: Record<string, (...args: unknown[]) => unknown> & {
      maybeSingle?: () => Promise<QueryResult>;
      single?: () => Promise<QueryResult>;
      then?: (resolve: (value: QueryResult) => unknown) => Promise<unknown>;
    } = {};
    const passthrough = () => () => chain;

    for (const method of ['select', 'eq', 'in', 'limit', 'neq', 'order']) {
      chain[method] = passthrough();
    }

    chain.single = () =>
      Promise.resolve(
        table === 'orders' ? orderDetailResult : getTableResult(table)
      );
    chain.maybeSingle = () => Promise.resolve(getTableResult(table));
    // biome-ignore lint/suspicious/noThenProperty: Mocking a Supabase query builder
    chain.then = (resolve) =>
      Promise.resolve(getTableResult(table)).then(resolve);

    return chain;
  }

  return {
    from: vi.fn((table: string) => makeChain(table)),
    reset: () => {
      tableResults.clear();
      orderDetailResult = {
        data: {
          id: 'order-1',
          recorded_by_user_id: 'user-1',
          total: 100,
          wallet_amount_used: 0,
        },
        error: null,
      };
    },
    setTableResult: (table: string, nextResult: QueryResult) => {
      tableResults.set(table, [nextResult]);
    },
    setTableResults: (table: string, nextResults: QueryResult[]) => {
      tableResults.set(table, [...nextResults]);
    },
  };
});

const queryMock = vi.hoisted(() => ({
  useQuery: vi.fn((config) => config),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: supabaseMock.from,
  },
}));

vi.mock('@/lib/orders', () => ({
  ORDER_COLUMNS: 'id, merchant_id',
}));

vi.mock('@/lib/supabase-utils', () => ({
  getJoinedRecord: (record: unknown) =>
    Array.isArray(record) ? record[0] : record,
}));

vi.mock('@/schemas/branch', () => ({
  ALL_BRANCH_SCOPE: { type: 'all' },
}));

vi.mock('../useBranchScope', () => ({
  useBranchScope: () => ({ scope: { type: 'all' } }),
}));

vi.mock('../useMerchant', () => ({
  useMerchant: () => ({ merchant: { id: 'merchant-1' } }),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>(
    '@tanstack/react-query'
  );

  return {
    ...actual,
    useQuery: queryMock.useQuery,
  };
});

import { fetchOrderById } from './useOrderDetails';

describe('fetchOrderById staff metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMock.reset();
  });

  it('resolves staff-created order metadata when staff records exist', async () => {
    supabaseMock.setTableResult('staff_members', {
      data: { id: 'staff-1', name: 'Ada Merchant' },
      error: null,
    });
    supabaseMock.setTableResult('virtual_terminals', {
      data: {
        account_name: 'Ada Terminal',
        account_number: '1234567890',
        bank: 'Kuda',
      },
      error: null,
    });

    await expect(fetchOrderById('order-1', 'merchant-1')).resolves.toEqual(
      expect.objectContaining({
        recorded_by_name: 'Ada',
        staff_terminal: {
          account_name: 'Ada Terminal',
          account_number: '1234567890',
          bank_name: 'Kuda',
        },
      })
    );
    expect(supabaseMock.from).not.toHaveBeenCalledWith('profiles');
  });

  it('does not fail when optional staff metadata records are absent', async () => {
    await expect(fetchOrderById('order-1', 'merchant-1')).resolves.toEqual(
      expect.objectContaining({
        recorded_by_name: null,
        staff_terminal: null,
      })
    );
  });

  it('falls back to inactive staff names when no active staff row exists', async () => {
    supabaseMock.setTableResults('staff_members', [
      { data: null, error: null },
      { data: { name: 'Removed Staff' }, error: null },
    ]);

    await expect(fetchOrderById('order-1', 'merchant-1')).resolves.toEqual(
      expect.objectContaining({
        recorded_by_name: 'Removed',
        staff_terminal: null,
      })
    );
    expect(supabaseMock.from).not.toHaveBeenCalledWith('virtual_terminals');
    expect(supabaseMock.from).not.toHaveBeenCalledWith('profiles');
  });

  it('does not fail when inactive staff fallback lookup errors', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // Silence expected log-and-skip auxiliary lookup errors.
    });

    try {
      supabaseMock.setTableResults('staff_members', [
        { data: null, error: null },
        { data: null, error: { message: 'Inactive staff lookup failed' } },
      ]);

      await expect(fetchOrderById('order-1', 'merchant-1')).resolves.toEqual(
        expect.objectContaining({
          recorded_by_name: null,
          staff_terminal: null,
        })
      );

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'useOrderDetails inactive staff_members lookup error:',
        expect.objectContaining({ message: 'Inactive staff lookup failed' })
      );
      expect(supabaseMock.from).not.toHaveBeenCalledWith('profiles');
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('falls back to merchant owner metadata when no staff row exists', async () => {
    supabaseMock.setTableResults('staff_members', [
      { data: null, error: null },
      { data: null, error: null },
    ]);
    supabaseMock.setTableResult('merchants', {
      data: {
        business_name: 'Baci Store',
        email: 'owner@example.com',
        user_id: 'user-1',
      },
      error: null,
    });

    await expect(fetchOrderById('order-1', 'merchant-1')).resolves.toEqual(
      expect.objectContaining({
        recorded_by_name: 'Baci',
        staff_terminal: null,
      })
    );
    expect(supabaseMock.from).not.toHaveBeenCalledWith('profiles');
  });

  it('does not fail when merchant owner fallback lookup errors', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // Silence expected log-and-skip auxiliary lookup errors.
    });

    try {
      supabaseMock.setTableResults('staff_members', [
        { data: null, error: null },
        { data: null, error: null },
      ]);
      supabaseMock.setTableResult('merchants', {
        data: null,
        error: { message: 'Merchant lookup failed' },
      });

      await expect(fetchOrderById('order-1', 'merchant-1')).resolves.toEqual(
        expect.objectContaining({
          recorded_by_name: null,
          staff_terminal: null,
        })
      );

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'useOrderDetails merchant recorder lookup error:',
        expect.objectContaining({ message: 'Merchant lookup failed' })
      );
      expect(supabaseMock.from).not.toHaveBeenCalledWith('profiles');
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => {
  type QueryResult = {
    data: unknown;
    error: { message: string } | null;
  };
  const tableResults = new Map<string, QueryResult>();

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

    const result = () => tableResults.get(table) ?? { data: null, error: null };
    chain.single = () =>
      Promise.resolve(
        table === 'orders'
          ? {
              data: {
                id: 'order-1',
                recorded_by_user_id: 'user-1',
                total: 100,
                wallet_amount_used: 0,
              },
              error: null,
            }
          : result()
      );
    chain.maybeSingle = () => Promise.resolve(result());
    // biome-ignore lint/suspicious/noThenProperty: Mocking a Supabase query builder
    chain.then = (resolve) => Promise.resolve(result()).then(resolve);

    return chain;
  }

  return {
    from: vi.fn((table: string) => makeChain(table)),
    reset: () => tableResults.clear(),
    setTableResult: (table: string, nextResult: QueryResult) => {
      tableResults.set(table, nextResult);
    },
  };
});

const queryMock = vi.hoisted(() => ({
  useQuery: vi.fn((config) => config),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { from: supabaseMock.from },
}));
vi.mock('@/lib/orders', () => ({ ORDER_COLUMNS: 'id, merchant_id' }));
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
  return { ...actual, useQuery: queryMock.useQuery };
});

import { fetchOrderById } from './useOrderDetails';

describe('fetchOrderById staff metadata errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMock.reset();
  });

  it('warns about staff member lookup errors but still resolves the order', async () => {
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});

    try {
      supabaseMock.setTableResult('staff_members', {
        data: null,
        error: { message: 'Staff lookup failed' },
      });

      await expect(fetchOrderById('order-1', 'merchant-1')).resolves.toEqual(
        expect.objectContaining({ staff_terminal: null })
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'useOrderDetails staff_members lookup error:',
        expect.objectContaining({ message: 'Staff lookup failed' })
      );
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('warns about terminal lookup errors but still resolves the order', async () => {
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});

    try {
      supabaseMock.setTableResult('staff_members', {
        data: { id: 'staff-1', name: 'Ada Merchant' },
        error: null,
      });
      supabaseMock.setTableResult('virtual_terminals', {
        data: null,
        error: { message: 'Terminal lookup failed' },
      });

      await expect(fetchOrderById('order-1', 'merchant-1')).resolves.toEqual(
        expect.objectContaining({ staff_terminal: null })
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'useOrderDetails virtual_terminals lookup error:',
        expect.objectContaining({ message: 'Terminal lookup failed' })
      );
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });
});

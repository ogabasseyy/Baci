import { vi } from 'vitest';

const supabaseMock = vi.hoisted(() => {
  type QueryResult = {
    data: unknown;
    error: { message: string } | null;
  };
  const chains: Array<{
    calls: Array<{ args: unknown[]; method: string }>;
    table: string;
  }> = [];
  let orderDetailResult: QueryResult = {
    data: {
      id: 'order-1',
      recorded_by_user_id: null,
      total: 100,
      wallet_amount_used: 0,
    },
    error: null,
  };
  const tableResults = new Map<string, QueryResult>();

  function getTableResult(table: string): QueryResult {
    return tableResults.get(table) ?? { data: [], error: null };
  }

  function getFilteredTableResult(
    table: string,
    calls: Array<{ args: unknown[]; method: string }>
  ): QueryResult {
    const result = getTableResult(table);
    if (table !== 'transactions' || !Array.isArray(result.data)) return result;

    const transactionType = calls.find(
      (call) => call.method === 'eq' && call.args[0] === 'transaction_type'
    )?.args[1];
    if (typeof transactionType !== 'string') return result;

    return {
      ...result,
      data: result.data.filter(
        (row) =>
          typeof row === 'object' &&
          row !== null &&
          'transaction_type' in row &&
          row.transaction_type === transactionType
      ),
    };
  }

  function makeChain(table: string) {
    const chain: Record<string, (...args: unknown[]) => unknown> & {
      maybeSingle?: () => Promise<QueryResult>;
      single?: () => Promise<QueryResult>;
      then?: (resolve: (value: QueryResult) => unknown) => Promise<unknown>;
    } = {};
    const calls: Array<{ args: unknown[]; method: string }> = [];

    chains.push({ table, calls });

    const passthrough =
      (method: string) =>
      (...args: unknown[]) => {
        calls.push({ method, args });
        return chain;
      };

    for (const method of [
      'select',
      'eq',
      'in',
      'gte',
      'lte',
      'order',
      'range',
    ]) {
      chain[method] = passthrough(method);
    }

    chain.single = () =>
      Promise.resolve(
        table === 'orders' ? orderDetailResult : getTableResult(table)
      );
    chain.maybeSingle = () =>
      Promise.resolve(tableResults.get(table) ?? { data: null, error: null });
    // biome-ignore lint/suspicious/noThenProperty: Mocking a promise chain
    chain.then = (resolve) =>
      Promise.resolve(getFilteredTableResult(table, calls)).then(resolve);

    return chain;
  }

  return {
    chains,
    from: vi.fn((table: string) => makeChain(table)),
    reset: () => {
      chains.length = 0;
      tableResults.clear();
      orderDetailResult = {
        data: {
          id: 'order-1',
          recorded_by_user_id: null,
          total: 100,
          wallet_amount_used: 0,
        },
        error: null,
      };
    },
    setOrderDetailResult: (nextResult: QueryResult) => {
      orderDetailResult = nextResult;
    },
    setTableResult: (table: string, nextResult: QueryResult) => {
      tableResults.set(table, nextResult);
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

import { fetchOrderById, useOrder } from './useOrderDetails';

export function fetchOrderByIdForTest(
  ...args: Parameters<typeof fetchOrderById>
) {
  return fetchOrderById(...args);
}

export function useOrderForTest(...args: Parameters<typeof useOrder>) {
  return useOrder(...args);
}

export const orderDetailsTestMocks = { queryMock, supabaseMock };

export function resetOrderDetailsMocks() {
  vi.clearAllMocks();
  supabaseMock.reset();
}

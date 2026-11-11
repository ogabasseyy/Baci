import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => {
  type QueryResult = {
    count: number;
    data: Array<
      Record<string, unknown> & {
        id: string;
        order_items: Array<{ id: string }>;
        payment_status: unknown;
        shipping_status: unknown;
      }
    >;
    error: { message: string } | null;
  };
  const chainCalls: Array<{ args: unknown[]; method: string }> = [];
  let result: QueryResult = {
    count: 1,
    data: [
      {
        id: 'order-1',
        order_items: [{ id: 'item-1' }],
        payment_status: 'paid',
        shipping_status: 'pending',
      },
    ],
    error: null,
  };

  function makeChain() {
    const chain: Record<string, (...args: unknown[]) => unknown> & {
      then?: (
        resolve: (value: {
          count: number;
          data: QueryResult['data'];
          error: QueryResult['error'];
        }) => unknown
      ) => Promise<unknown>;
    } = {};
    const passthrough =
      (method: string) =>
      (...args: unknown[]) => {
        chainCalls.push({ method, args });
        return chain;
      };

    for (const method of [
      'select',
      'eq',
      'not',
      'or',
      'gte',
      'lte',
      'order',
      'range',
    ]) {
      chain[method] = passthrough(method);
    }

    Object.defineProperty(chain, 'then', {
      value: (resolve: Parameters<NonNullable<typeof chain.then>>[0]) =>
        Promise.resolve(result).then(resolve),
    });

    return chain;
  }

  return {
    chainCalls,
    from: vi.fn(() => makeChain()),
    reset: () => {
      chainCalls.length = 0;
      result = {
        count: 1,
        data: [
          {
            id: 'order-1',
            order_items: [{ id: 'item-1' }],
            payment_status: 'paid',
            shipping_status: 'pending',
          },
        ],
        error: null,
      };
    },
    setResult: (nextResult: QueryResult) => {
      result = nextResult;
    },
  };
});

const queryMock = vi.hoisted(() => ({
  useInfiniteQuery: vi.fn((config) => config),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: supabaseMock.from,
  },
}));

vi.mock('@/lib/orders', () => ({
  ORDER_COLUMNS: 'id, order_items(id)',
}));

vi.mock('@/lib/sanitize', () => ({
  sanitizeText: (value: string) => value.trim(),
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
    useInfiniteQuery: queryMock.useInfiniteQuery,
  };
});

import { ORDER_LIST_VISIBILITY_FILTER } from './order-list-visibility';
import { fetchOrders, useOrders } from './useOrdersList';

describe('fetchOrders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMock.reset();
  });

  it('applies branch_id only when a concrete branch scope is selected', async () => {
    await fetchOrders(
      'merchant-1',
      0,
      {},
      {
        type: 'branch',
        branchId: 'branch-1',
      }
    );

    expect(
      supabaseMock.chainCalls.filter(
        (call) => call.method === 'eq' && call.args[0] === 'branch_id'
      )
    ).toEqual([{ method: 'eq', args: ['branch_id', 'branch-1'] }]);
  });

  it('does not apply branch_id for all-location scope', async () => {
    await fetchOrders('merchant-1', 0, {}, { type: 'all' });

    expect(
      supabaseMock.chainCalls.filter(
        (call) => call.method === 'eq' && call.args[0] === 'branch_id'
      )
    ).toEqual([]);
  });

  it('throws when the branch-scoped orders query fails', async () => {
    supabaseMock.setResult({
      count: 0,
      data: [],
      error: { message: 'Orders unavailable' },
    });

    await expect(
      fetchOrders(
        'merchant-1',
        0,
        {},
        {
          type: 'branch',
          branchId: 'branch-1',
        }
      )
    ).rejects.toThrow('Orders unavailable');
  });

  it('throws when the all-location orders query fails', async () => {
    supabaseMock.setResult({
      count: 0,
      data: [],
      error: { message: 'Orders unavailable' },
    });

    await expect(
      fetchOrders('merchant-1', 0, {}, { type: 'all' })
    ).rejects.toThrow('Orders unavailable');
  });

  it('applies search, status, date range, pagination, and item counts', async () => {
    await expect(
      fetchOrders(
        'merchant-1',
        20,
        {
          status: 'delivered',
          search: '  Ada  ',
          dateFilter: {
            start: new Date('2026-05-01T12:00:00.000Z'),
            end: new Date('2026-05-03T12:00:00.000Z'),
          },
        },
        { type: 'all' }
      )
    ).resolves.toEqual({
      nextCursor: null,
      orders: [
        expect.objectContaining({
          id: 'order-1',
          item_count: 1,
          order_items: undefined,
        }),
      ],
      totalCount: 1,
    });

    expect(supabaseMock.chainCalls).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['shipping_status', 'delivered'] },
        {
          method: 'or',
          args: [
            'order_number.ilike."%Ada%",customer_name.ilike."%Ada%",customer_email.ilike."%Ada%",customer_phone.ilike."%Ada%",payment_method.ilike."%Ada%",tracking_number.ilike."%Ada%",tracking_token.ilike."%Ada%"',
          ],
        },
        { method: 'range', args: [20, 39] },
      ])
    );
    expect(
      supabaseMock.chainCalls.filter((call) => call.method === 'gte')
    ).toHaveLength(1);
    expect(
      supabaseMock.chainCalls.filter((call) => call.method === 'lte')
    ).toHaveLength(1);
  });

  it('applies payment-status filters separately from fulfillment status filters', async () => {
    await fetchOrders(
      'merchant-1',
      0,
      {
        paymentStatus: 'paid',
      },
      { type: 'all' }
    );

    expect(supabaseMock.chainCalls).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['payment_status', 'paid'] },
      ])
    );
    expect(supabaseMock.chainCalls).not.toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['shipping_status', 'paid'] },
      ])
    );
  });

  it('escapes order search wildcards before building PostgREST ilike filters', async () => {
    await fetchOrders(
      'merchant-1',
      0,
      {
        search: 'ORD_100%',
      },
      { type: 'all' }
    );

    expect(supabaseMock.chainCalls).toEqual(
      expect.arrayContaining([
        {
          method: 'or',
          args: [
            'order_number.ilike."%ORD\\\\_100\\\\%%",customer_name.ilike."%ORD\\\\_100\\\\%%",customer_email.ilike."%ORD\\\\_100\\\\%%",customer_phone.ilike."%ORD\\\\_100\\\\%%",payment_method.ilike."%ORD\\\\_100\\\\%%",tracking_number.ilike."%ORD\\\\_100\\\\%%",tracking_token.ilike."%ORD\\\\_100\\\\%%"',
          ],
        },
      ])
    );
  });

  it('quotes order search patterns so PostgREST reserved commas cannot split or filters', async () => {
    await fetchOrders(
      'merchant-1',
      0,
      {
        search: 'John, "JD"',
      },
      { type: 'all' }
    );

    expect(supabaseMock.chainCalls).toEqual(
      expect.arrayContaining([
        {
          method: 'or',
          args: [
            String.raw`order_number.ilike."%John, \"JD\"%",customer_name.ilike."%John, \"JD\"%",customer_email.ilike."%John, \"JD\"%",customer_phone.ilike."%John, \"JD\"%",payment_method.ilike."%John, \"JD\"%",tracking_number.ilike."%John, \"JD\"%",tracking_token.ilike."%John, \"JD\"%"`,
          ],
        },
      ])
    );
  });

  it('keeps checkout drop-offs out of the admin orders list', async () => {
    await fetchOrders('merchant-1', 0, {}, { type: 'all' });

    expect(supabaseMock.chainCalls).toEqual(
      expect.arrayContaining([
        {
          method: 'or',
          args: [ORDER_LIST_VISIBILITY_FILTER],
        },
      ])
    );
  });

  it('skips invalid rows without failing the whole orders view', async () => {
    supabaseMock.setResult({
      count: 2,
      data: [
        {
          id: 'order-valid',
          order_items: [{ id: 'item-1' }],
          payment_status: 'paid',
          shipping_status: 'pending',
        },
        {
          id: 'order-corrupt',
          order_items: [],
          payment_status: null,
          shipping_status: 'unknown-status',
        },
      ],
      error: null,
    });

    await expect(
      fetchOrders('merchant-1', 0, {}, { type: 'all' })
    ).resolves.toEqual({
      nextCursor: null,
      orders: [
        expect.objectContaining({
          id: 'order-valid',
          item_count: 1,
          shipping_status: 'pending',
        }),
      ],
      totalCount: 2,
    });
  });

  it('normalizes legacy fulfilled shipping statuses at the data boundary', async () => {
    supabaseMock.setResult({
      count: 1,
      data: [
        {
          id: 'order-fulfilled',
          order_items: [],
          payment_status: 'paid',
          shipping_status: 'fulfilled',
        },
      ],
      error: null,
    });

    await expect(
      fetchOrders('merchant-1', 0, {}, { type: 'all' })
    ).resolves.toEqual({
      nextCursor: null,
      orders: [
        expect.objectContaining({
          id: 'order-fulfilled',
          item_count: 0,
          shipping_status: 'delivered',
        }),
      ],
      totalCount: 1,
    });
  });

  it('configures the useOrders infinite query with branch-scope cache keys', async () => {
    const query = useOrders(
      'pending',
      'order-1',
      'Today',
      'paid'
    ) as unknown as {
      enabled: boolean;
      queryFn: (input: { pageParam?: number }) => Promise<unknown>;
      queryKey: unknown[];
    };

    expect(queryMock.useInfiniteQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        queryKey: [
          'orders',
          'merchant-1',
          {
            dateFilter: 'Today',
            paymentStatus: 'paid',
            search: 'order-1',
            status: 'pending',
          },
          'all',
        ],
      })
    );

    await query.queryFn({ pageParam: 0 });

    expect(supabaseMock.chainCalls).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['merchant_id', 'merchant-1'] },
        { method: 'eq', args: ['shipping_status', 'pending'] },
        { method: 'eq', args: ['payment_status', 'paid'] },
      ])
    );
  });
});

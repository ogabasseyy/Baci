import type { SupabaseClient } from '@supabase/supabase-js';
import type { Mock } from 'vitest';
import { vi } from 'vitest';
import type { JumiaOrder, JumiaOrderItem } from '@/schemas/jumia';

interface QueryOptions {
  terminalEqCall?: number;
  terminalInsert?: boolean;
  terminalIn?: boolean;
  terminalUpsert?: boolean;
}

export interface QueryMock {
  select: Mock<(_columns?: string) => QueryMock>;
  eq: Mock<
    (_column?: string, _value?: unknown) => QueryMock | Promise<unknown>
  >;
  neq: Mock<
    (_column?: string, _value?: unknown) => QueryMock | Promise<unknown>
  >;
  in: Mock<
    (_column?: string, _values?: unknown[]) => QueryMock | Promise<unknown>
  >;
  insert: Mock<(_payload?: unknown) => QueryMock | Promise<unknown>>;
  update: Mock<(_payload?: unknown) => QueryMock>;
  upsert: Mock<
    (_payload?: unknown, _options?: unknown) => QueryMock | Promise<unknown>
  >;
  delete: Mock<() => QueryMock>;
  maybeSingle: Mock<() => Promise<unknown>>;
  returns: Mock<() => Promise<unknown>>;
  single: Mock<() => Promise<unknown>>;
}

export interface MockCallSource {
  mock: {
    calls: unknown[][];
  };
}

export function getMockCallArg<T>(
  mock: MockCallSource,
  callIndex: number,
  argIndex: number
) {
  return mock.mock.calls[callIndex]?.[argIndex] as T | undefined;
}

export function createQuery(
  response: unknown,
  options: QueryOptions = {}
): QueryMock {
  let eqCalls = 0;
  const query = {} as QueryMock;
  query.select = vi.fn((_columns?: string) => query);
  query.eq = vi.fn((_column?: string, _value?: unknown) => {
    eqCalls += 1;
    return options.terminalEqCall === eqCalls
      ? Promise.resolve(response)
      : query;
  });
  query.neq = vi.fn((_column?: string, _value?: unknown) => query);
  query.in = vi.fn((_column?: string, _values?: unknown[]) =>
    options.terminalIn ? Promise.resolve(response) : query
  );
  query.insert = vi.fn((_payload?: unknown) =>
    options.terminalInsert ? Promise.resolve(response) : query
  );
  query.update = vi.fn((_payload?: unknown) => query);
  query.upsert = vi.fn((_payload?: unknown, _options?: unknown) =>
    options.terminalUpsert ? Promise.resolve(response) : query
  );
  query.delete = vi.fn(() => query);
  query.maybeSingle = vi.fn(() => Promise.resolve(response));
  query.returns = vi.fn(() => Promise.resolve(response));
  query.single = vi.fn(() => Promise.resolve(response));

  return query;
}

/**
 * Creates a partial SupabaseClient mock that supports queued `from()` and `rpc()`
 * responses. Other SupabaseClient members are intentionally not implemented.
 */
export function createSupabaseMock(
  tableQueries: Record<string, unknown[]>,
  rpcResponses: Record<string, unknown[]> = {}
): SupabaseClient {
  const tableQueryIndexes = new Map<string, number>();
  const rpcResponseIndexes = new Map<string, number>();

  return {
    from: vi.fn((table: string) => {
      const index = tableQueryIndexes.get(table) ?? 0;
      const query = tableQueries[table]?.[index];
      if (!query) {
        const queuedCount = tableQueries[table]?.length ?? 0;
        throw new Error(
          `Unexpected table "${table}" at call ${index + 1} (${queuedCount} queued)`
        );
      }
      tableQueryIndexes.set(table, index + 1);
      return query;
    }),
    rpc: vi.fn((fnName: string) => {
      const index = rpcResponseIndexes.get(fnName) ?? 0;
      const queuedCount = rpcResponses[fnName]?.length ?? 0;
      if (index >= queuedCount) {
        throw new Error(
          `Unexpected RPC "${fnName}" at call ${index + 1} (${queuedCount} queued)`
        );
      }
      const response = rpcResponses[fnName]?.[index];
      rpcResponseIndexes.set(fnName, index + 1);
      return Promise.resolve(response);
    }),
  } as unknown as SupabaseClient;
}

export const order: JumiaOrder = {
  id: 'jumia-order-1',
  shopIds: ['shop-1'],
  totalItems: 1,
  packedItems: 0,
  isPrepayment: true,
  hasMultipleStatus: false,
  hasItemsFulfilledByJumia: false,
  pendingSince: '2026-04-25T08:00:00.000Z',
  status: 'ready_to_ship',
  deliveryOption: 'standard',
  number: '12345',
  totalAmount: { currency: 'NGN', value: 250000 },
  country: { code: 'NG', name: 'Nigeria', currencyCode: 'NGN' },
  shippingAddress: {
    firstName: 'Ada',
    lastName: 'Lovelace',
    address: '10 Jumia Road',
    city: 'Lagos',
    postalCode: '100001',
    ward: 'Ikeja',
    region: 'Lagos',
    countryName: 'Nigeria',
  },
  createdAt: '2026-04-25T08:01:00.000Z',
  updatedAt: '2026-04-25T08:02:00.000Z',
  totalAmountLocal: { currency: 'NGN', value: 250000 },
};

export const item: JumiaOrderItem = {
  id: 'item-1',
  shopId: 'shop-1',
  product: {
    name: 'Samsung Phone',
    sellerSku: 'SKU-1',
    imageUrl: 'https://example.com/phone.jpg',
  },
  status: 'ready_to_ship',
  trackingNumber: '',
  trackingUrl: '',
  shipmentType: 'standard',
  deliveryOption: 'standard',
  isFulfilledByJumia: false,
  itemPrice: 250000,
  paidPrice: 245000,
  shippingAmount: 0,
  itemPriceLocal: 250000,
  paidPriceLocal: 245000,
  shippingAmountLocal: 0,
  exchangeRate: 1,
  country: { code: 'NG', name: 'Nigeria', currencyCode: 'NGN' },
  taxAmount: 0,
  voucherAmount: 5000,
  shippingAddress: { ...order.shippingAddress },
};

interface DuplicateNotificationSyncMockOptions {
  jumiaOrder?: JumiaOrder;
  markerQueries?: QueryMock[];
}

/**
 * Creates a Supabase mock for duplicate-notification sync scenarios.
 *
 * @param options - See {@link DuplicateNotificationSyncMockOptions}.
 * @param options.jumiaOrder - Jumia order fixture to use; defaults to `order`.
 * @param options.markerQueries - Extra `jumia_orders` marker queries injected
 * before the duplicate cache upsert.
 */
export function createDuplicateNotificationSyncMock({
  jumiaOrder = order,
  markerQueries = [],
}: DuplicateNotificationSyncMockOptions = {}) {
  const marketplaceQuery = createQuery(
    {
      data: [
        {
          id: 'integration-1',
          merchant_id: 'merchant-1',
          shop_id: 'shop-1',
          last_sync_at: '2026-04-25T07:00:00.000Z',
          sync_config: { orders: true },
        },
      ],
      error: null,
    },
    { terminalEqCall: 2 }
  );
  const existingJumiaQuery = createQuery({
    data: [
      {
        jumia_order_id: jumiaOrder.id,
        notification_sent: false,
        baci_order_id: null,
      },
    ],
    error: null,
  });
  const existingCanonicalQuery = createQuery({ data: [], error: null });
  const insertOrderQuery = createQuery({
    data: {
      id: 'baci-order-1',
      external_id: jumiaOrder.id,
      tracking_token: 'tracking-token',
    },
    error: null,
  });
  const updateOrderQuery = createQuery({
    data: {
      id: 'baci-order-1',
      external_id: jumiaOrder.id,
      tracking_token: 'tracking-token',
    },
    error: null,
  });
  const cacheQuery = createQuery({ error: null }, { terminalUpsert: true });
  const duplicateCacheQuery = createQuery(
    { error: null },
    { terminalUpsert: true }
  );
  const syncCursorQuery = createQuery({ error: null }, { terminalEqCall: 1 });

  return {
    duplicateCacheQuery,
    supabase: createSupabaseMock(
      {
        marketplace_integrations: [marketplaceQuery, syncCursorQuery],
        jumia_orders: [
          existingJumiaQuery,
          cacheQuery,
          ...markerQueries,
          duplicateCacheQuery,
        ],
        orders: [existingCanonicalQuery, insertOrderQuery, updateOrderQuery],
      },
      {
        replace_order_items: [{ error: null }],
        replace_order_items_suppressing_order_notifications: [{ error: null }],
      }
    ),
  };
}

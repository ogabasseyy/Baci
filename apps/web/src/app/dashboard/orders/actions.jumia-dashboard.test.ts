import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getMerchantForApiRequest: vi.fn(),
  getUser: vi.fn(),
  loadOrderItemImageMap: vi.fn(() => Promise.resolve(new Map())),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => Promise.resolve(new Map())),
}));

vi.mock('@/lib/email-templates', () => ({
  generateOrderConfirmationEmail: vi.fn(),
  generateOrderConfirmationText: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('@/lib/merchant-server', () => ({
  ensurePermission: vi.fn(),
}));

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: (...args: unknown[]) =>
    mocks.getMerchantForApiRequest(...args),
}));

vi.mock('@/lib/sanitize-core', () => ({
  sanitizeLikePattern: (value: string) => value,
  sanitizeSearchQuery: (value: string) => value,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: mocks.getUser,
    },
    from: mocks.from,
  })),
}));

vi.mock('@/lib/zeptomail', () => ({
  sendEmail: vi.fn(),
}));

vi.mock('./order-item-images', () => ({
  loadOrderItemImageMap: mocks.loadOrderItemImageMap,
}));

const { getOrderStats, getOrders } = await import('./actions');

const MERCHANT_ID = 'merchant-456';
interface QueryResult {
  data?: unknown;
  error?: { message: string } | null;
  count?: number | null;
}

interface MockSupabaseQuery extends Promise<QueryResult> {
  select: ReturnType<
    typeof vi.fn<(_columns?: string, _options?: unknown) => MockSupabaseQuery>
  >;
  eq: ReturnType<
    typeof vi.fn<(_column: string, _value: unknown) => MockSupabaseQuery>
  >;
  is: ReturnType<
    typeof vi.fn<(_column: string, _value: unknown) => MockSupabaseQuery>
  >;
  or: ReturnType<typeof vi.fn<(_filter: string) => MockSupabaseQuery>>;
  order: ReturnType<
    typeof vi.fn<(_column: string, _options?: unknown) => MockSupabaseQuery>
  >;
  in: ReturnType<
    typeof vi.fn<(_column: string, _values: unknown[]) => MockSupabaseQuery>
  >;
  maybeSingle: ReturnType<typeof vi.fn<() => Promise<QueryResult>>>;
}

function createQuery(result: QueryResult): MockSupabaseQuery {
  let query: MockSupabaseQuery;
  query = Object.assign(Promise.resolve(result), {
    select: vi.fn((_columns?: string, _options?: unknown) => query),
    eq: vi.fn((_column: string, _value: unknown) => query),
    is: vi.fn((_column: string, _value: unknown) => query),
    or: vi.fn((_filter: string) => query),
    order: vi.fn((_column: string, _options?: unknown) => query),
    in: vi.fn((_column: string, _values: unknown[]) => query),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
  });
  return query;
}

describe('Jumia dashboard order data', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'admin-user' } },
      error: null,
    });
    mocks.getMerchantForApiRequest.mockResolvedValue({
      merchantId: MERCHANT_ID,
      staffAccess: {
        isOwner: true,
        isStaff: false,
        role: null,
        permissions: { full_access: { all: true } },
      },
    });
  });

  it('returns an empty order list when caller is unauthenticated', async () => {
    mocks.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: null,
    });

    await expect(getOrders(MERCHANT_ID)).resolves.toEqual([]);

    expect(mocks.getMerchantForApiRequest).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('returns an empty order list when caller has no merchant access', async () => {
    mocks.getMerchantForApiRequest.mockResolvedValueOnce(null);

    await expect(getOrders(MERCHANT_ID)).resolves.toEqual([]);

    expect(mocks.getMerchantForApiRequest).toHaveBeenCalledWith(
      expect.anything(),
      'admin-user',
      { requestedMerchantId: MERCHANT_ID }
    );
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('honors global wildcard view permissions for dashboard order lists', async () => {
    mocks.getMerchantForApiRequest.mockResolvedValueOnce({
      merchantId: MERCHANT_ID,
      staffAccess: {
        isOwner: false,
        isStaff: true,
        role: 'manager',
        permissions: { '*': { view: true } },
      },
    });
    const ordersQuery = createQuery({ data: [], error: null });
    const jumiaQuery = createQuery({ data: [], error: null });
    mocks.from.mockImplementation((table: string) => {
      if (table === 'orders') return ordersQuery;
      if (table === 'jumia_orders') return jumiaQuery;
      throw new Error(`Unexpected table: ${table}`);
    });

    await expect(getOrders(MERCHANT_ID)).resolves.toEqual([]);

    expect(mocks.from).toHaveBeenCalledWith('orders');
    expect(mocks.from).toHaveBeenCalledWith('jumia_orders');
  });

  it('scopes Jumia link views to the requested integration', async () => {
    mocks.getMerchantForApiRequest.mockResolvedValueOnce({
      merchantId: MERCHANT_ID,
      staffAccess: { isOwner: true },
    });
    const integrationQuery = createQuery({
      data: { shop_id: 'shop-1', marketplace_key: 'NG-main' },
      error: null,
    });
    const ordersQuery = createQuery({ data: [], error: null });
    const jumiaQuery = createQuery({ data: [], error: null });
    mocks.from.mockImplementation((table: string) => {
      if (table === 'marketplace_integrations') return integrationQuery;
      if (table === 'orders') return ordersQuery;
      if (table === 'jumia_orders') return jumiaQuery;
      throw new Error(`Unexpected table: ${table}`);
    });

    await expect(
      getOrders(MERCHANT_ID, {
        source: 'jumia',
        jumiaIntegrationId: 'integration-1',
      })
    ).resolves.toEqual([]);

    expect(ordersQuery.eq).toHaveBeenCalledWith('source', 'jumia');
    expect(ordersQuery.eq).toHaveBeenCalledWith(
      'import_metadata->>shopId',
      'shop-1'
    );
    expect(ordersQuery.in).toHaveBeenCalledWith(
      'import_metadata->>marketplaceKey',
      ['NG-main', 'default']
    );
    expect(jumiaQuery.eq).toHaveBeenCalledWith('jumia_shop_id', 'shop-1');
    expect(jumiaQuery.in).toHaveBeenCalledWith('marketplace_key', [
      'NG-main',
      'default',
    ]);
  });

  it('returns nothing when the requested Jumia integration is foreign', async () => {
    mocks.getMerchantForApiRequest.mockResolvedValueOnce({
      merchantId: MERCHANT_ID,
      staffAccess: { isOwner: true },
    });
    const integrationQuery = createQuery({ data: null, error: null });
    mocks.from.mockImplementation((table: string) => {
      if (table === 'marketplace_integrations') return integrationQuery;
      throw new Error(`Unexpected table: ${table}`);
    });

    await expect(
      getOrders(MERCHANT_ID, { jumiaIntegrationId: 'integration-unknown' })
    ).resolves.toEqual([]);

    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it('returns an empty order list when filters fail validation', async () => {
    await expect(
      getOrders(MERCHANT_ID, {
        search: 'x'.repeat(201),
      })
    ).resolves.toEqual([]);

    expect(mocks.getMerchantForApiRequest).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('returns zeroed dashboard stats when caller is unauthenticated', async () => {
    mocks.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: null,
    });

    await expect(getOrderStats(MERCHANT_ID)).resolves.toEqual({
      totalOrders: 0,
      completedOrders: 0,
      unpaidOrders: 0,
      urgentOrders: 0,
    });

    expect(mocks.getMerchantForApiRequest).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('returns zeroed dashboard stats when caller has no merchant access', async () => {
    mocks.getMerchantForApiRequest.mockResolvedValueOnce(null);

    await expect(getOrderStats(MERCHANT_ID)).resolves.toEqual({
      totalOrders: 0,
      completedOrders: 0,
      unpaidOrders: 0,
      urgentOrders: 0,
    });

    expect(mocks.getMerchantForApiRequest).toHaveBeenCalledWith(
      expect.anything(),
      'admin-user',
      { requestedMerchantId: MERCHANT_ID }
    );
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('honors resource wildcard view permissions for dashboard order stats', async () => {
    mocks.getMerchantForApiRequest.mockResolvedValueOnce({
      merchantId: MERCHANT_ID,
      staffAccess: {
        isOwner: false,
        isStaff: true,
        role: 'manager',
        permissions: { orders: { '*': true } },
      },
    });
    const countQueries = [
      createQuery({ count: 12, error: null }),
      createQuery({ count: 5, error: null }),
      createQuery({ count: 3, error: null }),
      createQuery({ count: 4, error: null }),
    ];
    mocks.from.mockImplementation((table: string) => {
      expect(table).toBe('orders');
      const query = countQueries.shift();
      if (!query) {
        throw new Error('Unexpected extra stats query');
      }
      return query;
    });

    await expect(getOrderStats(MERCHANT_ID)).resolves.toEqual({
      totalOrders: 12,
      completedOrders: 5,
      unpaidOrders: 3,
      urgentOrders: 4,
    });

    expect(mocks.from).toHaveBeenCalledTimes(4);
  });

  it('returns zeroed dashboard stats when merchant ID fails validation', async () => {
    await expect(getOrderStats('')).resolves.toEqual({
      totalOrders: 0,
      completedOrders: 0,
      unpaidOrders: 0,
      urgentOrders: 0,
    });

    expect(mocks.getMerchantForApiRequest).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('includes canonical Jumia rows and only falls back to unlinked legacy Jumia rows for All filters', async () => {
    const ordersQuery = createQuery({
      data: [
        {
          id: 'order-canonical-jumia',
          order_number: 'JUMIA-CANONICAL',
          customer_name: 'jumia customer',
          total: '10000',
          shipping_status: 'delivered',
          payment_status: 'paid',
          payment_method: 'jumia',
          created_at: '2026-04-25T08:00:00.000Z',
          source: 'jumia',
          order_items: [],
        },
      ],
      error: null,
    });
    const jumiaQuery = createQuery({
      data: [
        {
          jumia_order_id: 'legacy-jumia-order-1',
          jumia_order_number: 'JUMIA-LEGACY',
          customer_name: 'Legacy Jumia Customer',
          total_amount: '25000',
          status: 'delivered',
          created_at_jumia: '2026-04-25T09:00:00.000Z',
          items: [],
        },
      ],
      error: null,
    });
    mocks.from.mockImplementation((table: string) => {
      if (table === 'orders') return ordersQuery;
      if (table === 'jumia_orders') return jumiaQuery;
      throw new Error(`Unexpected table: ${table}`);
    });

    const orders = await getOrders(MERCHANT_ID, {
      paymentStatus: 'All',
      shippingStatus: 'All',
    });

    expect(ordersQuery.or).not.toHaveBeenCalled();
    expect(jumiaQuery.is).toHaveBeenCalledWith('baci_order_id', null);
    expect(mocks.from).toHaveBeenCalledWith('jumia_orders');
    expect(orders.map((order) => order.orderNumber)).toEqual([
      'JUMIA-LEGACY',
      'JUMIA-CANONICAL',
    ]);
  });

  it('filters canonical Jumia orders natively without querying legacy Jumia rows', async () => {
    const ordersQuery = createQuery({ data: [], error: null });
    mocks.from.mockImplementation((table: string) => {
      if (table === 'orders') return ordersQuery;
      throw new Error(`Unexpected table: ${table}`);
    });

    await getOrders(MERCHANT_ID, { paymentStatus: 'Paid' });

    expect(mocks.from).not.toHaveBeenCalledWith('jumia_orders');
    expect(ordersQuery.eq).toHaveBeenCalledWith('payment_status', 'paid');
    expect(ordersQuery.or).not.toHaveBeenCalled();
  });

  it('applies status filters to scoped legacy Jumia rows', async () => {
    const ordersQuery = createQuery({ data: [], error: null });
    const jumiaQuery = createQuery({
      data: [
        {
          jumia_order_id: 'legacy-refunded',
          jumia_order_number: 'JUMIA-REFUNDED',
          customer_name: 'Refunded Customer',
          total_amount: '12000',
          status: 'canceled',
          created_at_jumia: '2026-04-25T09:00:00.000Z',
          items: [],
        },
        {
          jumia_order_id: 'legacy-pending',
          jumia_order_number: 'JUMIA-PENDING',
          customer_name: 'Pending Customer',
          total_amount: '8000',
          status: 'pending',
          created_at_jumia: '2026-04-25T10:00:00.000Z',
          items: [],
        },
      ],
      error: null,
    });
    mocks.from.mockImplementation((table: string) => {
      if (table === 'orders') return ordersQuery;
      if (table === 'jumia_orders') return jumiaQuery;
      throw new Error(`Unexpected table: ${table}`);
    });

    const orders = await getOrders(MERCHANT_ID, {
      source: 'jumia',
      paymentStatus: 'Refunded',
    });

    expect(mocks.from).toHaveBeenCalledWith('jumia_orders');
    expect(orders.map((order) => order.orderNumber)).toEqual([
      'JUMIA-REFUNDED',
    ]);
  });

  it('scopes source=agentic to persisted agentic order rows', async () => {
    const ordersQuery = createQuery({ data: [], error: null });
    mocks.from.mockImplementation((table: string) => {
      if (table === 'orders') return ordersQuery;
      throw new Error(`Unexpected table: ${table}`);
    });

    await getOrders(MERCHANT_ID, { source: 'agentic' });

    expect(ordersQuery.eq).toHaveBeenCalledWith('merchant_id', MERCHANT_ID);
    expect(ordersQuery.eq).toHaveBeenCalledWith('source', 'agentic_ai');
    expect(mocks.from).not.toHaveBeenCalledWith('jumia_orders');
  });

  it('throws a generic dashboard error when canonical order loading fails', async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === 'orders') {
        return createQuery({
          data: null,
          error: { message: 'orders failed' },
        });
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    await expect(getOrders(MERCHANT_ID)).rejects.toThrow(
      'Failed to fetch dashboard orders'
    );
  });

  it('returns an empty order list when both sources are empty', async () => {
    const ordersQuery = createQuery({ data: [], error: null });
    const jumiaQuery = createQuery({ data: [], error: null });
    mocks.from.mockImplementation((table: string) => {
      if (table === 'orders') return ordersQuery;
      if (table === 'jumia_orders') return jumiaQuery;
      throw new Error(`Unexpected table: ${table}`);
    });

    await expect(getOrders(MERCHANT_ID)).resolves.toEqual([]);
  });

  it('applies dashboard search to legacy Jumia fallback rows', async () => {
    const ordersQuery = createQuery({ data: [], error: null });
    const jumiaQuery = createQuery({ data: [], error: null });
    mocks.from.mockImplementation((table: string) => {
      if (table === 'orders') return ordersQuery;
      if (table === 'jumia_orders') return jumiaQuery;
      throw new Error(`Unexpected table: ${table}`);
    });

    await expect(
      getOrders(MERCHANT_ID, {
        paymentStatus: 'All',
        shippingStatus: 'All',
        search: 'Ada',
      })
    ).resolves.toEqual([]);

    expect(ordersQuery.or).toHaveBeenCalledWith(
      'customer_name.ilike.%Ada%,order_number.ilike.%Ada%'
    );
    expect(jumiaQuery.or).toHaveBeenCalledWith(
      'customer_name.ilike.%Ada%,jumia_order_number.ilike.%Ada%'
    );
    expect(ordersQuery.eq).not.toHaveBeenCalledWith(
      'payment_status',
      expect.anything()
    );
    expect(ordersQuery.eq).not.toHaveBeenCalledWith(
      'shipping_status',
      expect.anything()
    );
  });

  it('logs legacy Jumia fallback errors without failing canonical results', async () => {
    const ordersQuery = createQuery({ data: [], error: null });
    const jumiaQuery = createQuery({
      data: null,
      error: { message: 'legacy query failed' },
    });
    mocks.from.mockImplementation((table: string) => {
      if (table === 'orders') return ordersQuery;
      if (table === 'jumia_orders') return jumiaQuery;
      throw new Error(`Unexpected table: ${table}`);
    });

    await expect(getOrders(MERCHANT_ID)).resolves.toEqual([]);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Error fetching legacy Jumia orders',
        merchantId: MERCHANT_ID,
      })
    );
  });

  it('counts canonical Jumia orders in dashboard stats', async () => {
    const statsQueries = [
      createQuery({ count: 3, error: null }),
      createQuery({ count: 2, error: null }),
      createQuery({ count: 1, error: null }),
      createQuery({ count: 1, error: null }),
    ];
    const queryQueue = [...statsQueries];
    mocks.from.mockImplementation((table: string) => {
      if (table !== 'orders') {
        throw new Error(`Unexpected table: ${table}`);
      }
      const query = queryQueue.shift();
      if (!query) {
        throw new Error('Unexpected extra orders query');
      }
      return query;
    });

    const stats = await getOrderStats(MERCHANT_ID);

    expect(stats).toEqual({
      totalOrders: 3,
      completedOrders: 2,
      unpaidOrders: 1,
      urgentOrders: 1,
    });
    const orCalls = statsQueries.flatMap((query) =>
      query.or.mock.calls.map(([filter]) => filter)
    );
    expect(orCalls).toContain(
      'payment_status.eq.unpaid,shipping_status.eq.pending'
    );
  });

  it('returns zeroed dashboard stats when any count query fails', async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const statsQueries = [
      createQuery({ count: null, error: { message: 'stats failed' } }),
      createQuery({ count: 2, error: null }),
      createQuery({ count: 1, error: null }),
      createQuery({ count: 1, error: null }),
    ];
    const queryQueue = [...statsQueries];
    mocks.from.mockImplementation((table: string) => {
      if (table !== 'orders') {
        throw new Error(`Unexpected table: ${table}`);
      }
      const query = queryQueue.shift();
      if (!query) {
        throw new Error('Unexpected extra orders query');
      }
      return query;
    });

    await expect(getOrderStats(MERCHANT_ID)).resolves.toEqual({
      totalOrders: 0,
      completedOrders: 0,
      unpaidOrders: 0,
      urgentOrders: 0,
    });
    expect(errorSpy).toHaveBeenCalledWith(
      'Error fetching order stats counts:',
      {
        message: 'stats failed',
      }
    );
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateClient = vi.fn();
const mockGetMerchantForApiRequest = vi.fn();

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: (...args: unknown[]) =>
    mockGetMerchantForApiRequest(...args),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

const { getDashboardMetrics, getMonthlyChartData, getRecentSales } =
  await import('./actions');

const zeroMetrics = {
  activeNow: { change: 0, value: 0 },
  aov: 0,
  customers: { change: 0, value: 0 },
  fulfillmentRate: 0,
  orders: { change: 0, value: 0 },
  revenue: { change: 0, value: 0 },
};

interface RecentSalesOrder {
  customer_email: string | null;
  customer_name: string | null;
  id: string;
  payment_status: string;
  total: number | string | null;
}

function createOrdersQuery({
  data,
  error,
}: {
  data: RecentSalesOrder[] | null;
  error: { message: string } | null;
}) {
  const query = {
    eq: vi.fn(),
    limit: vi.fn(),
    order: vi.fn(),
    select: vi.fn(),
  };

  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockResolvedValue({ data, error });

  return query;
}

function createSupabaseClient(query: ReturnType<typeof createOrdersQuery>) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null,
      }),
    },
    from: vi.fn(() => query),
  };
}

function createDashboardSupabaseClient(rpc = vi.fn()) {
  return {
    ...createSupabaseClient(
      createOrdersQuery({
        data: [],
        error: null,
      })
    ),
    rpc,
  };
}

function createMonthlyChartSupabaseClient(rpc: ReturnType<typeof vi.fn>) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null,
      }),
    },
    rpc,
  };
}

describe('dashboard actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMerchantForApiRequest.mockResolvedValue({
      merchantId: 'merchant-1',
      staffAccess: {
        isOwner: true,
        isStaff: false,
        permissions: { full_access: { all: true } },
        role: null,
      },
    });
  });

  it('limits recent sales to paid orders before rendering them as completed sales', async () => {
    const query = createOrdersQuery({
      data: [
        {
          customer_email: 'ada@example.com',
          customer_name: 'Ada',
          id: 'order-1',
          payment_status: 'paid',
          total: '12500',
        },
      ],
      error: null,
    });
    const supabaseClient = createSupabaseClient(query);
    mockCreateClient.mockResolvedValue(supabaseClient);

    const sales = await getRecentSales('merchant-1', 3);

    expect(supabaseClient.auth.getUser).toHaveBeenCalledTimes(1);
    expect(mockGetMerchantForApiRequest).toHaveBeenCalledWith(
      supabaseClient,
      'user-1',
      { requestedMerchantId: 'merchant-1' }
    );
    expect(supabaseClient.from).toHaveBeenCalledWith('orders');
    expect(query.select).toHaveBeenCalledWith(
      'id, customer_name, customer_email, total, payment_status'
    );
    expect(query.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(query.eq).toHaveBeenCalledWith('payment_status', 'paid');
    expect(query.order).toHaveBeenCalledWith('created_at', {
      ascending: false,
    });
    expect(query.limit).toHaveBeenCalledWith(3);
    expect(sales).toEqual([
      {
        amount: 12500,
        email: 'ada@example.com',
        id: 'order-1',
        name: 'Ada',
        status: 'Completed',
      },
    ]);
  });

  it('returns an empty recent sales list when the paid sales query fails', async () => {
    const query = createOrdersQuery({
      data: null,
      error: { message: 'orders failed' },
    });
    mockCreateClient.mockResolvedValue(createSupabaseClient(query));

    await expect(getRecentSales('merchant-1')).resolves.toEqual([]);
  });

  it('returns an empty recent sales list when there are no paid orders', async () => {
    const query = createOrdersQuery({
      data: [],
      error: null,
    });
    mockCreateClient.mockResolvedValue(createSupabaseClient(query));

    await expect(getRecentSales('merchant-1')).resolves.toEqual([]);
  });

  it('uses customer fallbacks and numeric amounts for paid recent sales', async () => {
    const query = createOrdersQuery({
      data: [
        {
          customer_email: null,
          customer_name: null,
          id: 'order-2',
          payment_status: 'paid',
          total: '990.5',
        },
      ],
      error: null,
    });
    mockCreateClient.mockResolvedValue(createSupabaseClient(query));

    await expect(getRecentSales('merchant-1')).resolves.toEqual([
      {
        amount: 990.5,
        email: 'no-email@example.com',
        id: 'order-2',
        name: 'Unknown Customer',
        status: 'Completed',
      },
    ]);
  });

  it('does not query recent sales when the caller has no merchant access', async () => {
    const query = createOrdersQuery({
      data: [],
      error: null,
    });
    const supabaseClient = createSupabaseClient(query);
    mockCreateClient.mockResolvedValue(supabaseClient);
    mockGetMerchantForApiRequest.mockResolvedValue(null);

    const result = await getRecentSales('merchant-1', 5);

    expect(result).toEqual([]);
    expect(supabaseClient.from).not.toHaveBeenCalled();
  });

  it('does not query recent sales for unauthenticated callers', async () => {
    const query = createOrdersQuery({
      data: [],
      error: null,
    });
    const supabaseClient = createSupabaseClient(query);
    supabaseClient.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: null,
    });
    mockCreateClient.mockResolvedValue(supabaseClient);

    const result = await getRecentSales('merchant-1', 5);

    expect(result).toEqual([]);
    expect(mockGetMerchantForApiRequest).not.toHaveBeenCalled();
    expect(supabaseClient.from).not.toHaveBeenCalled();
  });

  it('does not query recent sales for invalid action arguments', async () => {
    const result = await getRecentSales('merchant-1', 0);

    expect(result).toEqual([]);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('loads monthly chart data from the dashboard sales RPC', async () => {
    const rpc = vi.fn(async () => ({
      data: [{ month: 'May', orders: 2, profit: 500, revenue: 12500 }],
      error: null,
    }));
    const supabaseClient = createMonthlyChartSupabaseClient(rpc);
    mockCreateClient.mockResolvedValue(supabaseClient);
    mockGetMerchantForApiRequest.mockResolvedValueOnce({
      merchantId: 'merchant-authorized',
      staffAccess: {
        isOwner: true,
        isStaff: false,
        permissions: { full_access: { all: true } },
        role: null,
      },
    });

    await expect(getMonthlyChartData('merchant-tampered')).resolves.toEqual([
      { month: 'May', orders: 2, profit: 500, revenue: 12500 },
    ]);
    expect(supabaseClient.auth.getUser).toHaveBeenCalledTimes(1);
    expect(mockGetMerchantForApiRequest).toHaveBeenCalledWith(
      supabaseClient,
      'user-1',
      { requestedMerchantId: 'merchant-tampered' }
    );
    expect(rpc).toHaveBeenCalledWith('get_monthly_sales_stats', {
      p_merchant_id: 'merchant-authorized',
    });
  });

  it('returns an empty monthly chart when the dashboard sales RPC fails', async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: 'rpc failed' },
    }));
    mockCreateClient.mockResolvedValue(createMonthlyChartSupabaseClient(rpc));

    await expect(getMonthlyChartData('merchant-1')).resolves.toEqual([]);
  });

  it('does not load monthly chart data for unauthenticated callers', async () => {
    const rpc = vi.fn();
    const supabaseClient = createMonthlyChartSupabaseClient(rpc);
    supabaseClient.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: null,
    });
    mockCreateClient.mockResolvedValue(supabaseClient);

    const result = await getMonthlyChartData('merchant-1');

    expect(result).toEqual([]);
    expect(mockGetMerchantForApiRequest).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not load monthly chart data when the caller has no merchant access', async () => {
    const rpc = vi.fn();
    const supabaseClient = createMonthlyChartSupabaseClient(rpc);
    mockCreateClient.mockResolvedValue(supabaseClient);
    mockGetMerchantForApiRequest.mockResolvedValueOnce(null);

    const result = await getMonthlyChartData('merchant-1');

    expect(result).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not load monthly chart data for invalid action arguments', async () => {
    const result = await getMonthlyChartData('   ');

    expect(result).toEqual([]);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('authorizes dashboard metrics before calling the RPC with the request client', async () => {
    const rpc = vi.fn();
    const supabaseClient = createDashboardSupabaseClient(rpc);
    const metrics = {
      activeNow: { change: 0, value: 2 },
      aov: 625,
      customers: { change: 20, value: 4 },
      fulfillmentRate: 75,
      orders: { change: 33, value: 8 },
      revenue: { change: 50, value: 5000 },
    };
    mockCreateClient.mockResolvedValue(supabaseClient);
    mockGetMerchantForApiRequest.mockResolvedValueOnce({
      merchantId: 'merchant-authorized',
      staffAccess: {
        isOwner: true,
        isStaff: false,
        permissions: { full_access: { all: true } },
        role: null,
      },
    });
    rpc.mockResolvedValue({ data: metrics, error: null });

    const result = await getDashboardMetrics('merchant-tampered');

    expect(supabaseClient.auth.getUser).toHaveBeenCalledTimes(1);
    expect(mockGetMerchantForApiRequest).toHaveBeenCalledWith(
      supabaseClient,
      'user-1',
      { requestedMerchantId: 'merchant-tampered' }
    );
    expect(rpc).toHaveBeenCalledWith('get_sales_dashboard_stats', {
      p_merchant_id: 'merchant-authorized',
    });
    expect(result).toEqual(metrics);
  });

  it('falls back to zeroed metrics for unauthenticated callers', async () => {
    const supabaseClient = createDashboardSupabaseClient();
    supabaseClient.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: null,
    });
    mockCreateClient.mockResolvedValue(supabaseClient);

    const result = await getDashboardMetrics('merchant-1');

    expect(result).toEqual(zeroMetrics);
    expect(mockGetMerchantForApiRequest).not.toHaveBeenCalled();
    expect(supabaseClient.rpc).not.toHaveBeenCalled();
  });

  it('falls back to zeroed metrics when the caller has no merchant access', async () => {
    const supabaseClient = createDashboardSupabaseClient();
    mockCreateClient.mockResolvedValue(supabaseClient);
    mockGetMerchantForApiRequest.mockResolvedValueOnce(null);

    const result = await getDashboardMetrics('merchant-1');

    expect(result).toEqual(zeroMetrics);
    expect(supabaseClient.rpc).not.toHaveBeenCalled();
  });

  it('falls back to zeroed metrics when dashboard stats are unavailable', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    mockCreateClient.mockResolvedValue(createDashboardSupabaseClient(rpc));

    const result = await getDashboardMetrics('merchant-1');

    expect(result).toEqual(zeroMetrics);
  });

  it('falls back to zeroed metrics when the dashboard RPC shape is invalid', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { revenue: 'not-a-metric' },
      error: null,
    });
    mockCreateClient.mockResolvedValue(createDashboardSupabaseClient(rpc));

    await expect(getDashboardMetrics('merchant-1')).resolves.toEqual(
      zeroMetrics
    );
  });

  it('falls back to zeroed metrics when the dashboard RPC fails', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'rpc failed' },
    });
    mockCreateClient.mockResolvedValue(createDashboardSupabaseClient(rpc));

    const result = await getDashboardMetrics('merchant-1');

    expect(result).toEqual(zeroMetrics);
  });

  it('falls back to zeroed metrics for invalid action arguments', async () => {
    const result = await getDashboardMetrics('   ');

    expect(result).toEqual(zeroMetrics);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
});

'use server';

import { getMerchantForApiRequest } from '@/lib/get-merchant-for-api-request';
import { createClient } from '@/lib/supabase/server';
import {
  dashboardMerchantActionArgsSchema,
  dashboardMetricsResultSchema,
  dashboardRecentSalesArgsSchema,
} from '@/schemas/dashboard-actions';

export interface DashboardMetrics {
  revenue: {
    value: number;
    change: number;
  };
  customers: {
    value: number;
    change: number;
  };
  orders: {
    value: number;
    change: number;
  };
  activeNow: {
    value: number;
    change: number;
  };
  fulfillmentRate: number;
  aov: number;
}

export interface MonthlyChartData {
  month: string;
  revenue: number;
  profit: number;
  orders: number;
}

export interface RecentSale {
  id: string;
  name: string;
  email: string;
  amount: number;
  status: 'Completed' | 'Processing' | 'Failed' | 'Pending';
}

function getZeroDashboardMetrics(): DashboardMetrics {
  return {
    revenue: { value: 0, change: 0 },
    customers: { value: 0, change: 0 },
    orders: { value: 0, change: 0 },
    activeNow: { value: 0, change: 0 },
    fulfillmentRate: 0,
    aov: 0,
  };
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

async function getAuthorizedDashboardMerchantId(
  supabase: SupabaseServerClient,
  userId: string,
  requestedMerchantId: string
): Promise<string | null> {
  const merchantContext = await getMerchantForApiRequest(supabase, userId, {
    requestedMerchantId,
  });

  return merchantContext?.merchantId ?? null;
}

export async function getDashboardMetrics(
  merchantId: string
): Promise<DashboardMetrics> {
  try {
    const args = dashboardMerchantActionArgsSchema.safeParse({ merchantId });
    if (!args.success) {
      return getZeroDashboardMetrics();
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return getZeroDashboardMetrics();
    }

    const authorizedMerchantId = await getAuthorizedDashboardMerchantId(
      supabase,
      user.id,
      args.data.merchantId
    );

    if (!authorizedMerchantId) {
      return getZeroDashboardMetrics();
    }

    // Keep the RPC on the authenticated request client so PostgreSQL can
    // enforce the caller and merchant context. Do not move this user-facing
    // read behind a service-role cache.
    const { data: stats, error: statsError } = await supabase.rpc(
      'get_sales_dashboard_stats',
      { p_merchant_id: authorizedMerchantId }
    );

    if (statsError) {
      throw statsError;
    }

    const parsedStats = dashboardMetricsResultSchema.safeParse(stats);
    if (!parsedStats.success) {
      return getZeroDashboardMetrics();
    }

    return parsedStats.data;
  } catch (error) {
    console.error('Failed to fetch dashboard metrics:', error);
    return getZeroDashboardMetrics();
  }
}

export async function getRecentSales(
  merchantId: string,
  limit = 5
): Promise<RecentSale[]> {
  try {
    const args = dashboardRecentSalesArgsSchema.safeParse({
      limit,
      merchantId,
    });
    if (!args.success) {
      return [];
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return [];
    }

    const authorizedMerchantId = await getAuthorizedDashboardMerchantId(
      supabase,
      user.id,
      args.data.merchantId
    );

    if (!authorizedMerchantId) {
      return [];
    }

    const { data: orders, error } = await supabase
      .from('orders')
      .select('id, customer_name, customer_email, total, payment_status')
      .eq('merchant_id', authorizedMerchantId)
      .eq('payment_status', 'paid')
      .order('created_at', { ascending: false })
      .limit(args.data.limit);

    if (error) {
      console.error('Error fetching recent sales:', error);
      return [];
    }

    return (orders || []).map((order) => ({
      id: order.id,
      name: order.customer_name || 'Unknown Customer',
      email: order.customer_email || 'no-email@example.com',
      amount: Number(order.total) || 0,
      status: 'Completed',
    }));
  } catch (error) {
    console.error('Failed to fetch recent sales:', error);
    return [];
  }
}

export async function getMonthlyChartData(
  merchantId: string
): Promise<MonthlyChartData[]> {
  try {
    const args = dashboardMerchantActionArgsSchema.safeParse({ merchantId });
    if (!args.success) {
      return [];
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return [];
    }

    const authorizedMerchantId = await getAuthorizedDashboardMerchantId(
      supabase,
      user.id,
      args.data.merchantId
    );

    if (!authorizedMerchantId) {
      return [];
    }

    // OPTIMIZED: Use database RPC function
    const { data: chartData, error } = await supabase.rpc(
      'get_monthly_sales_stats',
      { p_merchant_id: authorizedMerchantId }
    );

    if (error) {
      console.error('Error fetching monthly chart data (RPC):', error);
      // Fallback to empty array
      return [];
    }

    return (chartData as unknown as MonthlyChartData[]) || [];
  } catch (error) {
    console.error('Failed to fetch monthly chart data:', error);
    return [];
  }
}

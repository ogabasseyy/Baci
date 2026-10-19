import type { SupabaseClient } from '@supabase/supabase-js';
import { buildAdminBusinessTypeBreakdowns } from '@/lib/admin-business-type-breakdowns';
import type { AdminAnalyticsPeriod } from '@/schemas/admin-analytics-query';
import { adminPlatformAnalyticsRpcSchema } from '@/schemas/admin-platform-analytics-rpc';
import type { PlatformAnalytics } from '@/types/analytics';
import type { Database } from '@/types/supabase';

interface AdminPlatformAnalyticsError {
  code?: string | null;
  message: string;
}

export async function getAdminPlatformAnalytics(
  supabase: SupabaseClient<Database>,
  period: AdminAnalyticsPeriod
): Promise<{
  data: PlatformAnalytics | null;
  error: AdminPlatformAnalyticsError | null;
}> {
  const rpcResult = await supabase.rpc('get_admin_platform_analytics', {
    p_period: period,
  });

  if (rpcResult.error) {
    return { data: null, error: rpcResult.error };
  }

  const parsed = adminPlatformAnalyticsRpcSchema.safeParse(rpcResult.data);
  if (!parsed.success) {
    return {
      data: null,
      error: {
        code: 'INVALID_ANALYTICS_PAYLOAD',
        message: 'Analytics aggregate returned an invalid payload',
      },
    };
  }

  const { businessTypeCounts, ...analytics } = parsed.data;
  return {
    data: {
      ...analytics,
      businessTypes: buildAdminBusinessTypeBreakdowns(
        businessTypeCounts,
        analytics.summary.totalMerchants
      ),
    },
    error: null,
  };
}

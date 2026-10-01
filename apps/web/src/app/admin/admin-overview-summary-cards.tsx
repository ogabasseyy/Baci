import { Activity, Building2, DollarSign, TrendingUp } from 'lucide-react';
import { AnalyticsCard } from '@/components/analytics/analytics-card';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { PlatformAnalytics } from '@/types/analytics';
import {
  type AnalyticsPeriod,
  adminOverviewUtils,
} from './admin-overview-utils';

interface AdminOverviewSummaryCardsProps {
  analytics: PlatformAnalytics | null;
  loading: boolean;
  period: AnalyticsPeriod;
}

const SKELETON_IDS = [
  'summary-skeleton-1',
  'summary-skeleton-2',
  'summary-skeleton-3',
  'summary-skeleton-4',
];

export function AdminOverviewSummaryCards({
  analytics,
  loading,
  period,
}: AdminOverviewSummaryCardsProps) {
  const hasComparison = period !== 'all';
  const scopeDescription =
    analytics && analytics.summary.excludedNonNgnOrUnknownPaidOrders > 0
      ? `NGN money only; ${analytics.summary.excludedNonNgnOrUnknownPaidOrders} paid order(s) outside that money total`
      : 'NGN-only reporting';

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {loading ? (
        SKELETON_IDS.map((skeletonId) => (
          <Card key={skeletonId} className="p-6">
            <Skeleton className="h-4 w-24 mb-4" />
            <Skeleton className="h-8 w-32 mb-2" />
            <Skeleton className="h-4 w-20" />
          </Card>
        ))
      ) : analytics ? (
        <>
          <AnalyticsCard
            change={
              hasComparison ? Math.abs(analytics.summary.gmvChange) : undefined
            }
            changeLabel={hasComparison ? undefined : 'N/A'}
            description={`${scopeDescription}; paid status as currently recorded for orders created in this window; created NGN order value ${adminOverviewUtils.formatCurrency(analytics.summary.grossGmv)}`}
            icon={DollarSign}
            title="Paid GMV"
            trend={
              hasComparison
                ? analytics.summary.gmvChange >= 0
                  ? 'up'
                  : 'down'
                : 'neutral'
            }
            value={adminOverviewUtils.formatCurrency(
              analytics.summary.totalGmv
            )}
          />
          <AnalyticsCard
            change={
              hasComparison
                ? Math.abs(analytics.summary.activeMerchantChange)
                : undefined
            }
            changeLabel={hasComparison ? undefined : 'N/A'}
            description={`Owner/staff login or session refresh; ${analytics.summary.sellingMerchants} NGN-selling; ${analytics.summary.totalMerchants} total`}
            icon={Building2}
            title="Merchants with Session Activity"
            trend={
              hasComparison
                ? analytics.summary.activeMerchantChange >= 0
                  ? 'up'
                  : 'down'
                : 'neutral'
            }
            value={analytics.summary.activeMerchants}
          />
          <AnalyticsCard
            description={`Across all recorded currencies; of ${adminOverviewUtils.formatNumber(analytics.summary.grossOrders)} created ${period === 'all' ? 'since launch' : `in the ${adminOverviewUtils.getPeriodLabel(period)}`}`}
            icon={Activity}
            title="Paid Orders"
            value={adminOverviewUtils.formatNumber(
              analytics.summary.totalOrders
            )}
          />
          <AnalyticsCard
            description={scopeDescription}
            icon={TrendingUp}
            title="Avg NGN GMV/Selling Merchant"
            value={adminOverviewUtils.formatCurrency(
              analytics.summary.avgGmvPerMerchant
            )}
          />
        </>
      ) : null}
    </div>
  );
}

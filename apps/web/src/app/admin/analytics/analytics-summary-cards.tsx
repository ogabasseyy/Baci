import {
  ArrowDownRight,
  ArrowUpRight,
  DollarSign,
  ShoppingCart,
  TrendingUp,
  Users,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { PlatformAnalytics } from '@/types/analytics';
import {
  formatAnalyticsCurrency,
  formatAnalyticsNumber,
  formatAnalyticsPercentage,
} from './analytics-format';

type AnalyticsSummaryCardsProps = {
  analytics: PlatformAnalytics | null;
  loading: boolean;
};

type ChangeMetricProps = {
  value: number;
};

function ChangeMetric({ value }: ChangeMetricProps) {
  const isPositive = value >= 0;
  const Icon = isPositive ? ArrowUpRight : ArrowDownRight;
  const colorClass = isPositive ? 'text-emerald-500' : 'text-red-500';

  return (
    <div className="flex items-center mt-1">
      <Icon className={`size-4 ${colorClass}`} />
      <span className={`text-sm ${colorClass}`}>
        {formatAnalyticsPercentage(value)}
      </span>
      <span className="text-sm text-muted-foreground ml-1">vs last period</span>
    </div>
  );
}

function SummaryCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-6">
        <Skeleton className="h-4 w-24 mb-2" />
        <Skeleton className="h-8 w-32 mb-1" />
        <Skeleton className="h-4 w-16" />
      </CardContent>
    </Card>
  );
}

export function AnalyticsSummaryCards({
  analytics,
  loading,
}: AnalyticsSummaryCardsProps) {
  if (loading) {
    return [...Array(4)].map((_, index) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders are static
      <SummaryCardSkeleton key={index} />
    ));
  }

  const summary = analytics?.summary;
  const moneyScopeDescription =
    (summary?.excludedNonNgnOrUnknownPaidOrders ?? 0) > 0
      ? `NGN money only; ${summary?.excludedNonNgnOrUnknownPaidOrders} paid order(s) outside that money total`
      : 'NGN-only reporting';

  return (
    <>
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">
              Paid GMV
            </p>
            <DollarSign className="size-4 text-muted-foreground" />
          </div>
          <p className="text-2xl font-bold mt-2">
            {formatAnalyticsCurrency(summary?.totalGmv ?? 0)}
          </p>
          <ChangeMetric value={summary?.gmvChange ?? 0} />
          <p className="text-xs text-muted-foreground mt-1">
            {moneyScopeDescription}; orders created in the selected window
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">
              Paid Orders
            </p>
            <ShoppingCart className="size-4 text-muted-foreground" />
          </div>
          <p className="text-2xl font-bold mt-2">
            {formatAnalyticsNumber(summary?.totalOrders ?? 0)}
          </p>
          <ChangeMetric value={summary?.orderChange ?? 0} />
          <p className="text-xs text-muted-foreground mt-1">
            Across all recorded currencies; orders created in the selected
            window
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">
              Avg Order Value
            </p>
            <TrendingUp className="size-4 text-muted-foreground" />
          </div>
          <p className="text-2xl font-bold mt-2">
            {formatAnalyticsCurrency(summary?.avgOrderValue ?? 0)}
          </p>
          <ChangeMetric value={summary?.aovChange ?? 0} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">
              Merchants with Session Activity
            </p>
            <Users className="size-4 text-muted-foreground" />
          </div>
          <p className="text-2xl font-bold mt-2">
            {formatAnalyticsNumber(summary?.activeMerchants ?? 0)}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Owner/staff login or session refresh;{' '}
            {formatAnalyticsNumber(summary?.sellingMerchants ?? 0)} made NGN
            paid sales
          </p>
        </CardContent>
      </Card>
    </>
  );
}

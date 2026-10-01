'use client';

import { useEffect, useState } from 'react';
import { OrderPipelineBreakdowns } from '@/app/admin/order-pipeline-breakdowns';
import { useToast } from '@/hooks/use-toast';
import type { PlatformAnalytics } from '@/types/analytics';
import { AdminDataErrorState } from '../admin-data-error-state';
import { AnalyticsCharts } from './analytics-charts';
import { formatAnalyticsDayLabel } from './analytics-format';
import { AnalyticsHeader } from './analytics-header';
import { AnalyticsMerchantPerformance } from './analytics-merchant-performance';
import { AnalyticsSummaryCards } from './analytics-summary-cards';
import type { AnalyticsPeriod } from './analytics-types';

const ANALYTICS_LOAD_ERROR =
  'Live analytics could not be loaded. No zero values are being shown in place of missing data.';

const ANALYTICS_PERIOD_LABELS: Record<AnalyticsPeriod, string> = {
  '7d': 'last 7 days',
  '30d': 'last 30 days',
  '90d': 'last 90 days',
};

async function loadPlatformAnalytics(
  period: AnalyticsPeriod
): Promise<{ data: PlatformAnalytics | null; ok: boolean }> {
  try {
    const response = await fetch(`/api/admin/analytics?period=${period}`);
    if (!response.ok) throw new Error('Failed to fetch analytics');
    const data = (await response.json()) as PlatformAnalytics;
    return { data, ok: true };
  } catch (error) {
    console.error('Failed to fetch analytics:', error);
    return { data: null, ok: false };
  }
}

function getPeriodLabel(period: AnalyticsPeriod): string {
  return ANALYTICS_PERIOD_LABELS[period];
}

export default function AnalyticsPage() {
  const [analytics, setAnalytics] = useState<PlatformAnalytics | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<AnalyticsPeriod>('30d');
  const [refreshing, setRefreshing] = useState(false);
  const { toast } = useToast();

  const reportLoadFailure = () => {
    setLoadError(ANALYTICS_LOAD_ERROR);
    toast({
      title: 'Error',
      description: 'Failed to load analytics data.',
      variant: 'destructive',
    });
  };

  const refreshAnalytics = async () => {
    setRefreshing(true);
    setLoadError(null);
    const { data, ok } = await loadPlatformAnalytics(period);
    if (ok) {
      setAnalytics(data);
    } else {
      reportLoadFailure();
    }
    setRefreshing(false);
  };

  useEffect(() => {
    let active = true;
    loadPlatformAnalytics(period).then(({ data, ok }) => {
      if (!active) return;
      if (ok) {
        setAnalytics(data);
        setLoadError(null);
      } else {
        setLoadError(ANALYTICS_LOAD_ERROR);
        toast({
          title: 'Error',
          description: 'Failed to load analytics data.',
          variant: 'destructive',
        });
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [period, toast]);

  const chartData =
    analytics?.dailyGmv.map((day) => ({
      date: formatAnalyticsDayLabel(day.date),
      gmv: day.gmv,
      orders: day.orders,
    })) ?? [];

  const handlePeriodChange = (nextPeriod: AnalyticsPeriod) => {
    setAnalytics(null);
    setLoadError(null);
    setLoading(true);
    setPeriod(nextPeriod);
  };

  const header = (
    <AnalyticsHeader
      loading={loading || refreshing}
      onPeriodChange={handlePeriodChange}
      onRefresh={() => {
        void refreshAnalytics();
      }}
      period={period}
    />
  );

  if (!loading && !analytics) {
    return (
      <div className="space-y-6">
        {header}
        <AdminDataErrorState
          message={
            loadError ??
            'Live analytics could not be loaded. No data is available.'
          }
          onRetry={() => {
            void refreshAnalytics();
          }}
          retrying={loading}
          title="Analytics unavailable"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      {loadError ? (
        <AdminDataErrorState
          message={loadError}
          onRetry={() => {
            void refreshAnalytics();
          }}
          retrying={refreshing}
          title="Analytics refresh failed"
        />
      ) : null}

      {refreshing ? (
        <div
          aria-live="polite"
          className="rounded-lg border border-muted bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
          role="status"
        >
          Refreshing live analytics. Displayed figures remain available until
          the refresh completes.
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <AnalyticsSummaryCards analytics={analytics} loading={loading} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <AnalyticsCharts chartData={chartData} loading={loading} />
        <AnalyticsMerchantPerformance analytics={analytics} loading={loading} />
      </div>

      <OrderPipelineBreakdowns
        loading={loading}
        paymentMethods={analytics?.paymentMethods ?? []}
        paymentStatuses={analytics?.paymentStatuses ?? []}
        periodLabel={getPeriodLabel(period)}
        shippingStatuses={analytics?.shippingStatuses ?? []}
      />
    </div>
  );
}

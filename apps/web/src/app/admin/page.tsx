'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { fetchWithCsrf } from '@/lib/api-client';
import type { PlatformAnalytics } from '@/types/analytics';
import { AdminDataErrorState } from './admin-data-error-state';
import { AdminOverviewCharts } from './admin-overview-charts';
import { AdminOverviewFinancialCards } from './admin-overview-financial-cards';
import { AdminOverviewHeader } from './admin-overview-header';
import { AdminOverviewMerchantActivity } from './admin-overview-merchant-activity';
import { AdminOverviewSummaryCards } from './admin-overview-summary-cards';
import { AdminOverviewTopMerchants } from './admin-overview-top-merchants';
import {
  type AnalyticsPeriod,
  adminOverviewUtils,
} from './admin-overview-utils';
import { OrderPipelineBreakdowns } from './order-pipeline-breakdowns';
import { PlatformPerformanceBreakdowns } from './platform-performance-breakdowns';

type LoadAnalyticsResult =
  | { data: PlatformAnalytics; status: 'ok' }
  | { status: 'forbidden' }
  | { error: unknown; status: 'error' };

async function loadPlatformAnalytics(
  period: AnalyticsPeriod
): Promise<LoadAnalyticsResult> {
  try {
    const response = await fetch(`/api/admin/analytics?period=${period}`);
    if (response.status === 403) return { status: 'forbidden' };
    if (!response.ok) throw new Error('Failed to fetch analytics');

    return { data: (await response.json()) as PlatformAnalytics, status: 'ok' };
  } catch (error) {
    return { error, status: 'error' };
  }
}

type RefreshResult = { status: 'ok' } | { error: unknown; status: 'error' };

async function postAnalyticsReload(): Promise<RefreshResult> {
  try {
    const response = await fetchWithCsrf('/api/admin/analytics', {
      method: 'POST',
    });
    if (!response.ok) throw new Error('Failed to refresh');

    return { status: 'ok' };
  } catch (error) {
    return { error, status: 'error' };
  }
}

export default function AdminDashboardPage() {
  const [analytics, setAnalytics] = useState<PlatformAnalytics | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState<AnalyticsPeriod>('all');
  const { toast } = useToast();
  const { replace } = useRouter();

  const handlePeriodChange = (nextPeriod: AnalyticsPeriod) => {
    setAnalytics(null);
    setLoadError(null);
    setLoading(true);
    setPeriod(nextPeriod);
  };

  const handleRefreshViews = () => {
    setRefreshing(true);
    setLoadError(null);

    return postAnalyticsReload()
      .then((refresh) => {
        if (refresh.status === 'error') throw refresh.error;
        return loadPlatformAnalytics(period);
      })
      .then((result) => {
        if (result.status === 'forbidden') {
          replace('/admin/blog');
          return;
        }
        if (result.status === 'error') throw result.error;

        setAnalytics(result.data);
        setLoadError(null);
        setLoading(false);
        toast({
          description: 'Platform analytics have been updated.',
          title: 'Data Refreshed',
        });
      })
      .catch((error: unknown) => {
        console.error('Failed to reload live analytics:', error);
        setLoadError(
          'Live platform analytics could not be refreshed. Existing figures may be stale.'
        );
        toast({
          description: 'Failed to reload live analytics.',
          title: 'Error',
          variant: 'destructive',
        });
      })
      .then(() => {
        setRefreshing(false);
      });
  };

  useEffect(() => {
    let active = true;
    loadPlatformAnalytics(period).then((result) => {
      if (!active) return;

      if (result.status === 'forbidden') {
        replace('/admin/blog');
        return;
      }

      if (result.status === 'ok') {
        setAnalytics(result.data);
        setLoadError(null);
      } else {
        console.error('Failed to fetch analytics:', result.error);
        setLoadError(
          'Live platform analytics could not be loaded. No zero values are being shown in place of missing data.'
        );
        toast({
          description: 'Failed to load platform analytics.',
          title: 'Error',
          variant: 'destructive',
        });
      }
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [period, replace, toast]);

  const header = (
    <AdminOverviewHeader
      loading={loading}
      onPeriodChange={handlePeriodChange}
      onRefresh={handleRefreshViews}
      period={period}
      refreshing={refreshing}
    />
  );

  if (!loading && !analytics) {
    return (
      <div className="space-y-6">
        {header}
        <AdminDataErrorState
          message={
            loadError ??
            'Live platform analytics could not be loaded. No data is available.'
          }
          onRetry={handleRefreshViews}
          retrying={refreshing}
          title="Platform analytics unavailable"
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
          onRetry={handleRefreshViews}
          retrying={refreshing}
          title="Platform analytics refresh failed"
        />
      ) : null}

      <AdminOverviewSummaryCards
        analytics={analytics}
        loading={loading}
        period={period}
      />
      <AdminOverviewFinancialCards analytics={analytics} loading={loading} />

      <div className="grid gap-6 lg:grid-cols-3">
        <AdminOverviewCharts analytics={analytics} loading={loading} />
        <AdminOverviewMerchantActivity
          analytics={analytics}
          loading={loading}
        />
      </div>

      <PlatformPerformanceBreakdowns
        businessTypes={analytics?.businessTypes ?? []}
        loading={loading}
        merchantActivation={analytics?.merchantActivation ?? []}
        periodLabel={adminOverviewUtils.getPeriodLabel(period)}
        salesByChannel={analytics?.salesByChannel ?? []}
        signupSources={analytics?.signupSources ?? []}
      />
      <OrderPipelineBreakdowns
        loading={loading}
        paymentMethods={analytics?.paymentMethods ?? []}
        paymentStatuses={analytics?.paymentStatuses ?? []}
        periodLabel={adminOverviewUtils.getPeriodLabel(period)}
        shippingStatuses={analytics?.shippingStatuses ?? []}
      />
      <AdminOverviewTopMerchants
        analytics={analytics}
        loading={loading}
        period={period}
      />

      {analytics ? (
        <p className="text-xs text-muted-foreground text-center">
          Last updated: {new Date(analytics.generatedAt).toLocaleString()}
        </p>
      ) : null}
    </div>
  );
}

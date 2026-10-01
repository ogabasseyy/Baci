import {
  formatAdminCompactCurrency,
  formatAdminCurrency,
} from '@/lib/admin-currency';
import type { PlatformAnalytics } from '@/types/analytics';
import { formatAnalyticsDayLabel } from './analytics/analytics-format';

export type AnalyticsPeriod = '7d' | '30d' | '90d' | 'all';

const PERIOD_LABELS: Record<AnalyticsPeriod, string> = {
  '7d': 'last 7 days',
  '30d': 'last 30 days',
  '90d': 'last 90 days',
  all: 'since analytics launch',
};

const HEALTH_COLORS = {
  atRisk: '#f59e0b',
  churned: '#ef4444',
  healthy: '#10b981',
  new: '#6366f1',
};

export const adminOverviewUtils = {
  formatCurrency(value: number): string {
    return value >= 1000
      ? formatAdminCompactCurrency(value)
      : formatAdminCurrency(value);
  },

  formatNumber(value: number): string {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
    return value.toString();
  },

  getPeriodLabel(period: AnalyticsPeriod): string {
    return PERIOD_LABELS[period];
  },

  getChartData(analytics: PlatformAnalytics | null) {
    return (
      analytics?.dailyGmv.map((entry) => ({
        date: formatAnalyticsDayLabel(entry.date),
        gmv: entry.gmv,
        merchants: entry.merchants,
        orders: entry.orders,
      })) ?? []
    );
  },

  getHealthData(analytics: PlatformAnalytics | null) {
    if (!analytics) return [];

    return [
      {
        color: HEALTH_COLORS.healthy,
        key: 'healthy',
        value: analytics.merchantHealth.healthy,
      },
      {
        color: HEALTH_COLORS.atRisk,
        key: 'at_risk',
        value: analytics.merchantHealth.atRisk,
      },
      {
        color: HEALTH_COLORS.churned,
        key: 'churned',
        value: analytics.merchantHealth.churned,
      },
      {
        color: HEALTH_COLORS.new,
        key: 'new',
        value: analytics.merchantHealth.new,
      },
    ].filter((entry) => entry.value > 0);
  },
};

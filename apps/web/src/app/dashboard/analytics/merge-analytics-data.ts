import type { AnalyticsData } from '@/components/analytics/analytics-grid-types';

export function mergeAnalyticsData(
  baseAnalytics: AnalyticsData | null,
  categoryAnalytics: Partial<AnalyticsData>
): AnalyticsData | null {
  if (!baseAnalytics && Object.keys(categoryAnalytics).length === 0) {
    return null;
  }

  return { ...(baseAnalytics ?? {}), ...categoryAnalytics };
}

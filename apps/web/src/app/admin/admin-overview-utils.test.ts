import { describe, expect, it } from 'vitest';
import type { PlatformAnalytics } from '@/types/analytics';
import { adminOverviewUtils } from './admin-overview-utils';

const analytics = {
  dailyGmv: [
    { date: '2026-03-20T00:00:00.000Z', gmv: 1200, merchants: 2, orders: 3 },
  ],
  merchantHealth: { atRisk: 2, churned: 0, healthy: 3, new: 0 },
} as PlatformAnalytics;

describe('adminOverviewUtils', () => {
  it('returns the human-readable selected period', () => {
    expect(adminOverviewUtils.getPeriodLabel('30d')).toBe('last 30 days');
  });

  it('does not create health chart entries for empty activity categories', () => {
    expect(adminOverviewUtils.getHealthData(analytics)).toEqual([
      { color: '#10b981', key: 'healthy', value: 3 },
      { color: '#f59e0b', key: 'at_risk', value: 2 },
    ]);
  });

  it('formats the paid GMV series without replacing live values', () => {
    expect(adminOverviewUtils.getChartData(analytics)).toEqual([
      { date: 'Mar 20', gmv: 1200, merchants: 2, orders: 3 },
    ]);
  });
});

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PlatformAnalytics } from '@/types/analytics';

vi.mock('@/components/analytics/analytics-card', () => ({
  AnalyticsCard: ({
    changeLabel,
    description,
    title,
    value,
  }: {
    changeLabel?: string;
    description?: string;
    title: string;
    value: string | number;
  }) => (
    <section>
      <h2>{title}</h2>
      <span>{value}</span>
      <span>{changeLabel}</span>
      <p>{description}</p>
    </section>
  ),
}));

import { AdminOverviewSummaryCards } from './admin-overview-summary-cards';

const analytics = {
  summary: {
    activeMerchantChange: -5,
    activeMerchants: 4,
    avgGmvPerMerchant: 500,
    excludedNonNgnOrUnknownPaidOrders: 2,
    gmvChange: 10,
    grossGmv: 1500,
    grossOrders: 9,
    sellingMerchants: 3,
    totalGmv: 1000,
    totalMerchants: 8,
    totalOrders: 7,
  },
} as PlatformAnalytics;

describe('AdminOverviewSummaryCards', () => {
  it('explains the NGN money scope and comparison data for a bounded period', () => {
    render(
      <AdminOverviewSummaryCards
        analytics={analytics}
        loading={false}
        period="30d"
      />
    );

    expect(screen.getByText('Paid GMV')).toBeInTheDocument();
    expect(
      screen.getAllByText(/2 paid order\(s\) outside that money total/)
    ).toHaveLength(2);
    expect(
      screen.getByText(/of 9 created in the last 30 days/)
    ).toBeInTheDocument();
  });

  it('uses neutral N/A comparisons for all-time analytics', () => {
    render(
      <AdminOverviewSummaryCards
        analytics={analytics}
        loading={false}
        period="all"
      />
    );

    expect(screen.getAllByText('N/A')).toHaveLength(2);
    expect(screen.getByText(/of 9 created since launch/)).toBeInTheDocument();
  });
});

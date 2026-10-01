import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { PlatformAnalytics } from '@/types/analytics';

function Chart({ children, data }: { children?: ReactNode; data?: unknown }) {
  return <div data-series={JSON.stringify(data)}>{children}</div>;
}

vi.mock('recharts', () => ({
  Area: Chart,
  AreaChart: Chart,
  CartesianGrid: Chart,
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
    <>{children}</>
  ),
  Tooltip: Chart,
  XAxis: Chart,
  YAxis: Chart,
}));

import { AdminOverviewCharts } from './admin-overview-charts';

const analytics = {
  dailyGmv: [
    { date: '2026-03-20T12:00:00.000Z', gmv: 1200, merchants: 2, orders: 3 },
  ],
} as PlatformAnalytics;

describe('AdminOverviewCharts', () => {
  it('renders the paid-NGN scope and formatted GMV series', () => {
    const { container } = render(
      <AdminOverviewCharts analytics={analytics} loading={false} />
    );

    expect(screen.getByText('NGN Paid GMV Over Time')).toBeInTheDocument();
    expect(
      screen.getByText(/non-NGN\/unknown-currency orders are excluded/i)
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-series*="Mar 20"]')
    ).toBeInTheDocument();
  });

  it('shows a chart placeholder while analytics are loading', () => {
    const { container } = render(
      <AdminOverviewCharts analytics={null} loading />
    );

    expect(
      container.querySelector('.motion-safe\\:animate-pulse')
    ).toBeInTheDocument();
    expect(container.querySelector('[data-series]')).not.toBeInTheDocument();
  });
});

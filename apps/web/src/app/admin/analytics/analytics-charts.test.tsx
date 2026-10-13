import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

function Chart({ children, data }: { children?: ReactNode; data?: unknown }) {
  return <div data-series={JSON.stringify(data)}>{children}</div>;
}

vi.mock('recharts', () => ({
  Area: Chart,
  AreaChart: Chart,
  Bar: Chart,
  BarChart: Chart,
  CartesianGrid: Chart,
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
    <>{children}</>
  ),
  Tooltip: Chart,
  XAxis: Chart,
  YAxis: Chart,
}));

import { AnalyticsCharts } from './analytics-charts';

describe('AnalyticsCharts', () => {
  it('passes daily GMV and order data to both order-created-date charts', () => {
    const { container } = render(
      <AnalyticsCharts
        chartData={[{ date: 'Mar 20', gmv: 1200, orders: 3 }]}
        loading={false}
      />
    );

    expect(
      screen.getByText('NGN GMV by Order-Created Date')
    ).toBeInTheDocument();
    expect(screen.getByText('Orders by Order-Created Day')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-series*="Mar 20"]')).toHaveLength(
      2
    );
  });

  it('shows placeholders instead of charts while data is loading', () => {
    const { container } = render(<AnalyticsCharts chartData={[]} loading />);

    expect(
      container.querySelectorAll('.motion-safe\\:animate-pulse')
    ).toHaveLength(2);
    expect(container.querySelector('[data-series]')).not.toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  OrdersChart,
  RevenueChart,
  SalesByChannelChart,
} from './chart-components';

function MockChart({ children }: { children?: ReactNode }) {
  return <div>{children}</div>;
}

function MockResponsiveContainer({
  minHeight,
  minWidth,
}: {
  minHeight?: number;
  minWidth?: number;
}) {
  return (
    <div
      data-min-height={minHeight}
      data-min-width={minWidth}
      data-testid="responsive-container"
    />
  );
}

vi.mock('recharts', () => ({
  Area: MockChart,
  AreaChart: MockChart,
  Bar: MockChart,
  BarChart: MockChart,
  CartesianGrid: MockChart,
  Cell: MockChart,
  Legend: MockChart,
  Pie: MockChart,
  PieChart: MockChart,
  ResponsiveContainer: MockResponsiveContainer,
  Tooltip: MockChart,
  XAxis: MockChart,
  YAxis: MockChart,
}));

const trendData = [{ day: 'Mon', orders: 2, revenue: 1200 }];
const channelData = [{ name: 'Storefront', value: 1200 }];

describe('analytics chart components', () => {
  it('sets explicit minimum dimensions on responsive charts', () => {
    render(
      <>
        <RevenueChart
          data={trendData}
          valueFormatter={(value) => `NGN ${value.toLocaleString()}`}
        />
        <OrdersChart data={trendData} />
        <SalesByChannelChart data={channelData} />
      </>
    );

    const containers = screen.getAllByTestId('responsive-container');

    expect(containers).toHaveLength(3);
    for (const container of containers) {
      expect(container).toHaveAttribute('data-min-width', '0');
      expect(container).toHaveAttribute('data-min-height', '0');
    }
  });
});

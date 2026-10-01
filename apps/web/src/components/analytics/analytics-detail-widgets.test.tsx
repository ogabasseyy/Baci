import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AnalyticsDetailWidgets } from './analytics-detail-widgets';

function formatCurrency(value: number) {
  return `NGN ${value.toLocaleString()}`;
}

describe('AnalyticsDetailWidgets', () => {
  it('shows orders and canonical brand revenue metrics', () => {
    render(
      <AnalyticsDetailWidgets
        data={{
          brandBreakdown: [{ name: 'Acme', revenue: 1250, value: 4 }],
          chartData: [{ day: 'Aug 1', orders: 4, revenue: 1250 }],
        }}
        formatCurrency={formatCurrency}
        widgetId="brand-breakdown"
      />
    );

    expect(screen.getByText('Sales by Brand')).toBeInTheDocument();
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('NGN 1,250')).toBeInTheDocument();
  });

  it('surfaces chart period order, profit, and tax totals', () => {
    render(
      <AnalyticsDetailWidgets
        data={{
          chartData: [
            { day: 'Aug 1', orders: 4, profit: 500, revenue: 1250, tax: 100 },
            { day: 'Aug 2', orders: 2, profit: 200, revenue: 600, tax: 50 },
          ],
        }}
        formatCurrency={formatCurrency}
        widgetId="orders-chart"
      />
    );

    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('NGN 700')).toBeInTheDocument();
    expect(screen.getByText('NGN 150')).toBeInTheDocument();
  });

  it('shows supplier cost, revenue, and unit metrics', () => {
    render(
      <AnalyticsDetailWidgets
        data={{
          supplierAnalytics: [
            {
              grossProfit: 500,
              lossUnitCount: 0,
              missingCostUnitCount: 0,
              orderCount: 2,
              supplierName: 'Supplier A',
              totalCost: 750,
              totalRevenue: 1250,
              unitCount: 5,
            },
          ],
        }}
        formatCurrency={formatCurrency}
        widgetId="supplier-breakdown"
      />
    );

    expect(screen.getByText('Supplier A')).toBeInTheDocument();
    expect(screen.getByText('NGN 500 gross profit')).toBeInTheDocument();
    expect(screen.getByText('5 units')).toBeInTheDocument();
    expect(screen.getByText('NGN 750 cost')).toBeInTheDocument();
  });

  it('shows blog counts and the most viewed post', () => {
    render(
      <AnalyticsDetailWidgets
        data={{
          blog: {
            draftPosts: 1,
            publishedPosts: 3,
            topPost: {
              id: 'post-1',
              slug: 'launch',
              title: 'Launch guide',
              viewCount: 42,
            },
            totalPosts: 4,
            totalViews: 100,
          },
        }}
        formatCurrency={formatCurrency}
        widgetId="blog-performance"
      />
    );

    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('Launch guide')).toBeInTheDocument();
    expect(screen.getByText('42 views')).toBeInTheDocument();
  });

  it('keeps an empty state when a breakdown has no rows', () => {
    render(
      <AnalyticsDetailWidgets
        data={{ customerBreakdown: [] }}
        formatCurrency={formatCurrency}
        widgetId="customer-breakdown"
      />
    );

    expect(
      screen.getByText('No data available for this period')
    ).toBeInTheDocument();
  });
});

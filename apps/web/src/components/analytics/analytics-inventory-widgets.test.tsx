import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AnalyticsInventoryWidgets } from './analytics-inventory-widgets';

describe('AnalyticsInventoryWidgets', () => {
  it('uses the resolved inventory count supplied by analytics', () => {
    render(
      <AnalyticsInventoryWidgets
        data={{ resolvedInventoryAlertCount: 6 }}
        isWidgetVisible={(id) => id === 'inventory-summary'}
      />
    );

    expect(screen.getByText('Resolved')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
  });

  it('lists out-of-stock no-sales products as low stock', () => {
    render(
      <AnalyticsInventoryWidgets
        data={{
          inventoryForecasts: [
            {
              avg_daily_sales: 0,
              current_stock: 0,
              days_of_stock: 999,
              product_id: 'out-of-stock',
              product_name: 'No-sales product',
              sales_trend: 'stable',
            },
          ],
        }}
        isWidgetVisible={(id) => id === 'low-stock-products'}
      />
    );

    expect(screen.getByText('No-sales product')).toBeInTheDocument();
    expect(screen.getByText('0 left')).toBeInTheDocument();
    expect(
      screen.queryByText('All products well stocked')
    ).not.toBeInTheDocument();
  });

  it('lists positive-stock threshold-critical products even with no sales', () => {
    render(
      <AnalyticsInventoryWidgets
        data={{
          inventoryForecasts: [
            {
              avg_daily_sales: 0,
              current_stock: 2,
              days_of_stock: 999,
              low_stock_threshold: 2,
              product_id: 'threshold-critical',
              product_name: 'Threshold-critical product',
              sales_trend: 'stable',
              status: 'critical',
            },
          ],
        }}
        isWidgetVisible={(id) => id === 'low-stock-products'}
      />
    );

    expect(screen.getByText('Threshold-critical product')).toBeInTheDocument();
    expect(screen.getByText('2 left')).toBeInTheDocument();
    expect(
      screen.queryByText('All products well stocked')
    ).not.toBeInTheDocument();
  });

  it('labels no-sales out-of-stock forecasts instead of showing 999 days', () => {
    render(
      <AnalyticsInventoryWidgets
        data={{
          inventoryForecasts: [
            {
              avg_daily_sales: 0,
              current_stock: 0,
              days_of_stock: 999,
              product_id: 'out-of-stock',
              product_name: 'Out-of-stock product',
              sales_trend: 'stable',
              status: 'out_of_stock',
            },
          ],
        }}
        isWidgetVisible={(id) => id === 'inventory-forecast'}
      />
    );

    expect(screen.getByText('Out of stock')).toBeInTheDocument();
    expect(screen.queryByText('999 days')).not.toBeInTheDocument();
  });
});

import { describe, expect, it } from 'vitest';
import { mergeAnalyticsData } from './merge-analytics-data';

describe('mergeAnalyticsData', () => {
  it('returns specialized data when base analytics are unavailable', () => {
    expect(
      mergeAnalyticsData(null, {
        inventoryForecasts: [
          {
            avg_daily_sales: 1,
            current_stock: 2,
            days_of_stock: 2,
            product_id: 'product-1',
            product_name: 'Phone',
            sales_trend: 'stable',
          },
        ],
      })
    ).toEqual(
      expect.objectContaining({
        inventoryForecasts: expect.arrayContaining([
          expect.objectContaining({ product_id: 'product-1' }),
        ]),
      })
    );
  });

  it('returns null when neither base nor specialized data is available', () => {
    expect(mergeAnalyticsData(null, {})).toBeNull();
  });

  it('preserves base fields while overlaying specialized data', () => {
    expect(
      mergeAnalyticsData(
        {
          summary: {
            activeNow: { change: 0, value: 1 },
            customers: { change: 0, value: 2 },
            revenue: { change: 0, value: 3 },
            sales: { change: 0, value: 4 },
          },
        },
        { lowStockCount: 1 }
      )
    ).toEqual(
      expect.objectContaining({
        lowStockCount: 1,
        summary: expect.objectContaining({ revenue: { change: 0, value: 3 } }),
      })
    );
  });
});

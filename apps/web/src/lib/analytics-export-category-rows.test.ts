import { describe, expect, it } from 'vitest';
import type { AnalyticsData } from '@/components/analytics/analytics-grid-types';
import {
  appendInventoryCsvRows,
  appendSegmentsCsvRows,
} from './analytics-export-category-rows';

describe('analytics export category rows', () => {
  it('includes inventory alerts and forecasts in the inventory export', () => {
    const rows: string[] = [];
    const data: Pick<
      AnalyticsData,
      | 'inventoryAlerts'
      | 'inventoryForecasts'
      | 'lowStockCount'
      | 'outOfStockCount'
      | 'resolvedInventoryAlertCount'
    > = {
      inventoryAlerts: [
        {
          alert_type: 'low_stock',
          current_stock: 2,
          id: 'alert-1',
          product_name: 'Phone',
          status: 'active',
        },
      ],
      inventoryForecasts: [
        {
          avg_daily_sales: 1,
          current_stock: 2,
          days_of_stock: 2,
          product_id: 'product-1',
          product_name: 'Phone',
          sales_trend: 'increasing',
          status: 'critical',
        },
      ],
      lowStockCount: 1,
      outOfStockCount: 0,
      resolvedInventoryAlertCount: 3,
    };

    appendInventoryCsvRows(rows, data);

    expect(rows.join('\n')).toContain('INVENTORY ALERTS');
    expect(rows.join('\n')).toContain('"Phone","low_stock","2","active"');
    expect(rows.join('\n')).toContain('INVENTORY FORECAST');
    expect(rows.join('\n')).toContain('"critical"');
  });

  it('includes segment lifetime values in the segment export', () => {
    const rows: string[] = [];
    appendSegmentsCsvRows(rows, {
      at_risk_count: 1,
      champions_count: 2,
      segments: [
        {
          avg_clv: 42,
          count: 2,
          segment: 'Champions',
          total_revenue: 84,
        },
      ],
      total_customers: 4,
    });

    expect(rows.join('\n')).toContain('CUSTOMER SEGMENTS (LIFETIME)');
    expect(rows.join('\n')).toContain('SEGMENT BREAKDOWN');
    expect(rows.join('\n')).toContain('"Champions"');
  });
});

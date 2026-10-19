import { describe, expect, it } from 'vitest';
import { analyticsDashboardSpecializedSchemas } from './analytics-dashboard-specialized';

describe('analyticsDashboardSpecializedSchemas', () => {
  it('parses bounded inventory and segment queries', () => {
    expect(
      analyticsDashboardSpecializedSchemas.inventoryForecastQuery.parse({
        limit: '100',
        lowStockOnly: 'true',
        page: '2',
      })
    ).toMatchObject({ limit: 100, lowStockOnly: true, page: 2 });
    expect(
      analyticsDashboardSpecializedSchemas.customerSegmentsQuery.parse({})
    ).toMatchObject({ limit: 20, page: 1 });
    expect(
      analyticsDashboardSpecializedSchemas.inventoryAlertsQuery.parse({})
    ).toEqual({ status: 'active' });
  });

  it('rejects invalid filters and unsafe action payloads', () => {
    expect(
      analyticsDashboardSpecializedSchemas.inventoryForecastQuery.safeParse({
        limit: '101',
      }).success
    ).toBe(false);
    expect(
      analyticsDashboardSpecializedSchemas.inventoryAlertsQuery.safeParse({
        status: 'deleted',
      }).success
    ).toBe(false);
    expect(
      analyticsDashboardSpecializedSchemas.inventoryAlertsAction.safeParse({
        action: 'resolve',
        alertIds: ['not-a-uuid'],
      }).success
    ).toBe(false);
  });
});

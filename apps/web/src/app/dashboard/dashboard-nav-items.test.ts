import { describe, expect, it } from 'vitest';
import { buildDashboardNavItems } from './dashboard-nav-items';

describe('buildDashboardNavItems', () => {
  it('sets the orders badge only when the count is positive', () => {
    const withOrders = buildDashboardNavItems(5).find(
      (item) => item.id === 'orders'
    );
    expect(withOrders?.badge).toBe(5);

    const withoutOrders = buildDashboardNavItems(0).find(
      (item) => item.id === 'orders'
    );
    expect(withoutOrders?.badge).toBeUndefined();
  });
});

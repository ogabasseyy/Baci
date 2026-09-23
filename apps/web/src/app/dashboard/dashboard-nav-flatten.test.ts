import { describe, expect, it } from 'vitest';
import { flattenDashboardNavItems } from './dashboard-nav-flatten';
import { buildDashboardNavItems } from './dashboard-nav-items';

describe('flattenDashboardNavItems', () => {
  it('flattens nested children after their parent', () => {
    const ids = flattenDashboardNavItems(buildDashboardNavItems(0)).map(
      (item) => item.id
    );
    expect(ids).toContain('marketing');
    expect(ids).toContain('discount-codes');
    expect(ids.indexOf('discount-codes')).toBeGreaterThan(
      ids.indexOf('marketing')
    );
  });
});

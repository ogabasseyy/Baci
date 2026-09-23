import { describe, expect, it, vi } from 'vitest';
import type { StaffAccess } from '@/hooks/merchant/types';
import {
  buildDashboardNavItems,
  type DashboardNavFilterContext,
  filterDashboardNavItems,
  flattenDashboardNavItems,
} from './dashboard-nav';

const ownerAccess: StaffAccess = {
  isStaff: false,
  isOwner: true,
  role: null,
  permissions: {},
};

function makeContext(
  overrides: Partial<DashboardNavFilterContext> = {}
): DashboardNavFilterContext {
  return {
    merchant: { slug: 'acme', business_type: 'electronics' },
    agenticMerchantSlug: null,
    staffAccess: ownerAccess,
    hasPermission: () => true,
    ...overrides,
  };
}

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

describe('filterDashboardNavItems', () => {
  it('shows everything to owners except tenant-gated items', () => {
    const ids = filterDashboardNavItems(
      buildDashboardNavItems(0),
      makeContext()
    ).map((item) => item.id);
    expect(ids).toContain('dashboard');
    expect(ids).toContain('migrations');
    // Santa Campaign is hidden without the agentic tenant slug.
    expect(ids).not.toContain('santa');
  });

  it('shows Santa Campaign for the configured agentic tenant', () => {
    const ids = filterDashboardNavItems(
      buildDashboardNavItems(0),
      makeContext({ agenticMerchantSlug: 'acme' })
    ).map((item) => item.id);
    expect(ids).toContain('santa');
  });

  it('hides Repairs for non-repairs business types', () => {
    const ids = filterDashboardNavItems(
      buildDashboardNavItems(0),
      makeContext({ merchant: { slug: 'acme', business_type: 'fashion' } })
    ).map((item) => item.id);
    expect(ids).not.toContain('repairs');
  });

  it('checks view permission for staff on mapped resources', () => {
    const hasPermission = vi.fn(() => false);
    const ids = filterDashboardNavItems(
      buildDashboardNavItems(0),
      makeContext({
        staffAccess: {
          isStaff: true,
          isOwner: false,
          role: 'sales_rep',
          permissions: {},
        },
        hasPermission,
      })
    ).map((item) => item.id);
    expect(ids).not.toContain('orders');
    expect(hasPermission).toHaveBeenCalledWith('orders', 'view');
  });

  it('filters children with the same rules as parents', () => {
    const hasPermission = vi.fn((resource: string) => resource !== 'marketing');
    const items = filterDashboardNavItems(
      buildDashboardNavItems(0),
      makeContext({
        staffAccess: {
          isStaff: true,
          isOwner: false,
          role: 'sales_rep',
          permissions: {},
        },
        hasPermission,
      })
    );
    const marketing = items.find((item) => item.id === 'marketing');
    expect(marketing).toBeUndefined();
  });
});

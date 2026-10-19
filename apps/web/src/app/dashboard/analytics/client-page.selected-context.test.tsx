import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const selectedMerchantId = '123e4567-e89b-42d3-a456-426614174000';
const state = vi.hoisted(() => ({
  canCustomizeLayout: true,
  canManageAdsIntegrations: true,
  gridMerchant: null as Record<string, unknown> | null,
  visibleCategories: [] as string[],
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () =>
    new URLSearchParams(`category=inventory&merchantId=${selectedMerchantId}`),
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: () => ({
    hasPermission: () => true,
    loading: false,
    merchant: {
      business_name: 'Default Store',
      country: 'NG',
      id: '11111111-1111-4111-8111-111111111111',
      payout_currency: 'NGN',
    },
  }),
}));
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));
vi.mock('@/components/analytics/analytics-category-nav', () => ({
  AnalyticsCategoryNav: (props: { visibleCategories?: string[] }) => {
    state.visibleCategories = props.visibleCategories ?? [];
    return null;
  },
  VALID_CATEGORIES: [
    'overview',
    'finance',
    'products',
    'customers',
    'marketing',
    'inventory',
    'segments',
    'ads',
  ],
}));
vi.mock('@/components/analytics/analytics-filters', () => ({
  AnalyticsFilters: () => null,
}));
vi.mock('@/components/analytics/draggable-analytics-grid', () => ({
  DraggableAnalyticsGrid: (props: {
    canCustomizeLayout: boolean;
    canManageAdsIntegrations: boolean;
    merchant?: Record<string, unknown> | null;
  }) => {
    state.canCustomizeLayout = props.canCustomizeLayout;
    state.canManageAdsIntegrations = props.canManageAdsIntegrations;
    state.gridMerchant = props.merchant ?? null;
    return <section aria-label="Analytics dashboard grid" />;
  },
}));
vi.mock('@/components/ui/bag-loader', () => ({
  BagLoader: () => <div>Loading...</div>,
}));

import AnalyticsClientPage from './client-page';

describe('AnalyticsClientPage selected callback context', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    state.gridMerchant = null;
    state.canCustomizeLayout = true;
    state.canManageAdsIntegrations = true;
    state.visibleCategories = [];
  });

  it('uses the non-default merchant country, currency, and permissions', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) =>
        String(input) === '/api/merchant/me'
          ? new Response(
              JSON.stringify({
                merchant: {
                  business_name: 'Selected Ghana Store',
                  business_type: 'fashion',
                  country: 'GH',
                  id: selectedMerchantId,
                  payout_currency: 'GHS',
                  slug: 'selected-ghana-store',
                  user_id: 'owner-2',
                },
                staffAccess: {
                  isOwner: false,
                  isStaff: true,
                  permissions: { analytics: { view: true } },
                  role: 'marketing',
                },
              })
            )
          : new Response(JSON.stringify({}))
      );

    render(<AnalyticsClientPage />);

    await waitFor(() =>
      expect(state.gridMerchant).toMatchObject({
        country: 'GH',
        id: selectedMerchantId,
        payout_currency: 'GHS',
      })
    );
    expect(state.visibleCategories).not.toContain('inventory');
    expect(state.visibleCategories).not.toContain('segments');
    expect(state.canCustomizeLayout).toBe(false);
    expect(state.canManageAdsIntegrations).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/merchant/me',
      expect.objectContaining({
        headers: { 'x-baci-merchant-id': selectedMerchantId },
      })
    );
  });

  it('shows an error instead of stale analytics when selected merchant loading fails', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
      );

    render(<AnalyticsClientPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to load the selected merchant. Please try again.'
    );
    expect(
      screen.queryByRole('region', { name: 'Analytics dashboard grid' })
    ).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

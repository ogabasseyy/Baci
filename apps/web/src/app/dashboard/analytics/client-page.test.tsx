import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockUseSearchParams = vi.hoisted(() =>
  vi.fn(() => new URLSearchParams())
);
const mockGridProps = vi.hoisted(() => ({
  categoryError: null as string | null,
  data: {} as Record<string, unknown>,
  loading: false,
}));
const mockHasPermission = vi.hoisted(() =>
  vi.fn<(resource: string, action: string) => boolean>(() => true)
);
const mockVisibleCategories = vi.hoisted(() => ({ value: [] as string[] }));
const mockToast = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useSearchParams: mockUseSearchParams,
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: vi.fn(() => ({
    hasPermission: mockHasPermission,
    merchant: { id: 'm-1', slug: 'test' },
    loading: false,
  })),
}));
vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({ toast: mockToast })),
}));
vi.mock('@/lib/analytics-export', () => ({
  exportAnalyticsAsCSV: vi.fn(),
  exportAnalyticsAsPDF: vi.fn(),
}));
vi.mock('@/components/analytics/analytics-category-nav', () => ({
  AnalyticsCategoryNav: (props: { visibleCategories?: string[] }) => {
    mockVisibleCategories.value = props.visibleCategories ?? [];
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
    categoryError?: string | null;
    data: Record<string, unknown>;
    loading: boolean;
  }) => {
    mockGridProps.categoryError = props.categoryError ?? null;
    mockGridProps.data = props.data;
    mockGridProps.loading = props.loading;
    return null;
  },
}));
vi.mock('@/components/ui/bag-loader', () => ({
  BagLoader: () => <div>Loading...</div>,
}));

import AnalyticsClientPage from './client-page';

describe('AnalyticsClientPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockUseSearchParams.mockReturnValue(new URLSearchParams());
    mockGridProps.categoryError = null;
    mockGridProps.data = {};
    mockGridProps.loading = false;
    mockHasPermission.mockReturnValue(true);
    mockVisibleCategories.value = [];
    mockToast.mockReset();
  });

  it('renders without crashing', () => {
    const { container } = render(<AnalyticsClientPage />);
    expect(container).toBeDefined();
  });

  it('loads inventory analytics for the selected merchant and date range', async () => {
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams('category=inventory')
    );
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/api/analytics?')) {
          return new Response(JSON.stringify({}), { status: 200 });
        }
        if (url.includes('/api/inventory/alerts?')) {
          return new Response(
            JSON.stringify({
              alerts: [
                {
                  alert_type: 'low_stock',
                  current_stock: 2,
                  id: 'alert-1',
                  products: { name: 'Phone' },
                  status: 'active',
                },
              ],
            }),
            { status: 200 }
          );
        }
        if (url.includes('/api/inventory/forecast?')) {
          return new Response(
            JSON.stringify({
              forecasts: [
                {
                  avgDailySales: 1,
                  currentStock: 2,
                  daysOfStock: 2,
                  productId: 'product-1',
                  productName: 'Phone',
                  salesTrend: 'increasing',
                },
              ],
              summary: { critical: 1, outOfStock: 0, warning: 0 },
            }),
            { status: 200 }
          );
        }
        throw new Error(`Unexpected request: ${url}`);
      });

    render(<AnalyticsClientPage />);

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).includes('/api/inventory/alerts?')
        )
      ).toBe(true);
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).includes('/api/inventory/forecast?')
        )
      ).toBe(true);
    });

    const baseRequest = fetchMock.mock.calls.find(([input]) =>
      String(input).includes('/api/analytics?')
    );
    expect(baseRequest?.[1]).toEqual(
      expect.objectContaining({
        headers: { 'x-baci-merchant-id': 'm-1' },
      })
    );

    const inventoryRequest = fetchMock.mock.calls.find(([input]) =>
      String(input).includes('/api/inventory/alerts?')
    );
    expect(inventoryRequest?.[1]).toEqual(
      expect.objectContaining({
        headers: { 'x-baci-merchant-id': 'm-1' },
      })
    );
  });

  it('uses the OAuth callback cache-bust token for the first ads request', async () => {
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams('category=ads&cacheBust=1724572800')
    );
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    render(<AnalyticsClientPage />);

    await waitFor(() => {
      const adsRequest = fetchMock.mock.calls.find(([input]) =>
        String(input).includes('/api/analytics/ads?')
      );
      expect(String(adsRequest?.[0])).toContain('cacheBust=1724572800');
    });
  });

  it('surfaces specialized analytics failures instead of rendering empty metrics', async () => {
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams('category=inventory')
    );
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/analytics?')) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'unavailable' }), {
        status: 503,
      });
    });

    render(<AnalyticsClientPage />);

    await waitFor(() => {
      expect(mockGridProps.categoryError).toBe(
        'Unable to load inventory analytics. Please try again.'
      );
    });
  });

  it('renders specialized analytics when the base analytics request fails', async () => {
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams('category=inventory')
    );
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/analytics?')) {
        return new Response(JSON.stringify({ error: 'unavailable' }), {
          status: 503,
        });
      }
      if (url.includes('/api/inventory/forecast?')) {
        return new Response(
          JSON.stringify({
            forecasts: [
              {
                avgDailySales: 1,
                currentStock: 2,
                daysOfStock: 2,
                productId: 'product-1',
                productName: 'Phone',
                salesTrend: 'increasing',
              },
            ],
            summary: { critical: 1, outOfStock: 0, warning: 0 },
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ alerts: [], stats: { total: 0 } }), {
        status: 200,
      });
    });

    render(<AnalyticsClientPage />);

    await waitFor(() => {
      expect(mockGridProps.data.inventoryForecasts).toEqual([
        expect.objectContaining({ product_id: 'product-1' }),
      ]);
    });
  });

  it('keeps the grid loading while specialized analytics are pending', async () => {
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams('category=inventory')
    );
    let resolveInventory: ((response: Response) => void) | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('/api/analytics?')) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return new Promise<Response>((resolve) => {
        resolveInventory = resolve;
      });
    });

    render(<AnalyticsClientPage />);

    await waitFor(() => expect(mockGridProps.loading).toBe(true));
    resolveInventory?.(
      new Response(JSON.stringify({ alerts: [], forecasts: [] }), {
        status: 200,
      })
    );
  });

  it('hides inventory and segments without their backing permissions', async () => {
    mockHasPermission.mockImplementation(
      (resource) => resource !== 'products' && resource !== 'customers'
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 })
    );

    render(<AnalyticsClientPage />);

    await waitFor(() => {
      expect(mockVisibleCategories.value).not.toContain('inventory');
      expect(mockVisibleCategories.value).not.toContain('segments');
    });
  });

  it('resets a specialized category when its permission is removed', async () => {
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams('category=inventory')
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ alerts: [], forecasts: [] }), {
        status: 200,
      })
    );
    const view = render(<AnalyticsClientPage />);
    mockHasPermission.mockImplementation((resource) => resource !== 'products');

    view.rerender(<AnalyticsClientPage />);

    await waitFor(() =>
      expect(mockVisibleCategories.value).not.toContain('inventory')
    );
  });

  it('surfaces provider callback failures and keeps the selected merchant scope', async () => {
    const merchantId = '123e4567-e89b-42d3-a456-426614174000';
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams(
        `category=ads&meta_ads=error&reason=provider_denied&merchantId=${merchantId}`
      )
    );
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    render(<AnalyticsClientPage />);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Meta Ads connection failed' })
      );
      expect(
        fetchMock.mock.calls.some(
          ([, init]) =>
            (init?.headers as Record<string, string> | undefined)?.[
              'x-baci-merchant-id'
            ] === merchantId
        )
      ).toBe(true);
    });
  });
});

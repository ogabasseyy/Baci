import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAnalyticsCategoryData } from './fetch-analytics-category-data';

const merchantId = 'merchant-1';
const from = new Date('2026-08-01T00:00:00.000Z');
const to = new Date('2026-08-07T23:59:59.999Z');

function localCalendarDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status });
}

describe('fetchAnalyticsCategoryData', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads and maps inventory alerts and forecasts for the selected merchant', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/inventory/alerts?status=active')) {
        return response({
          alerts: [
            {
              alert_type: 'low_stock',
              current_stock: 2,
              id: 'alert-1',
              products: { name: 'Phone' },
              status: 'active',
            },
          ],
        });
      }

      if (url.includes('/api/inventory/alerts?status=resolved')) {
        return response({
          alerts: [{ id: 'resolved-alert' }],
          stats: { total: 1 },
        });
      }

      return response({
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
        summary: { critical: 1, outOfStock: 0, warning: 2 },
      });
    });

    const result = await fetchAnalyticsCategoryData({
      category: 'inventory',
      from,
      merchantId,
      signal: new AbortController().signal,
      to,
    });

    expect(result).toMatchObject({
      inventoryAlerts: [
        {
          alert_type: 'low_stock',
          current_stock: 2,
          id: 'alert-1',
          product_name: 'Phone',
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
        },
      ],
      lowStockCount: 3,
      outOfStockCount: 0,
      resolvedInventoryAlertCount: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toEqual(
        expect.objectContaining({
          headers: { 'x-baci-merchant-id': merchantId },
        })
      );
    }
  });

  it('uses the exact server count for resolved alerts beyond the response cap', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ alerts: [], stats: { total: 0 } }))
      .mockResolvedValueOnce(
        response({
          forecasts: [],
          summary: { critical: 0, outOfStock: 0, warning: 0 },
        })
      )
      .mockResolvedValueOnce(
        response({
          alerts: [{ id: 'latest-resolved-alert' }],
          stats: { total: 1_501 },
        })
      );

    const result = await fetchAnalyticsCategoryData({
      category: 'inventory',
      from,
      merchantId,
      signal: new AbortController().signal,
      to,
    });

    expect(result.resolvedInventoryAlertCount).toBe(1_501);
  });

  it('uses one bounded forecast response for a large inventory catalog', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/inventory/alerts'))
        return response({ alerts: [] });
      return response({
        forecasts: [
          {
            avgDailySales: 0,
            currentStock: 0,
            daysOfStock: 0,
            productId: 'second',
            productName: 'Second',
            salesTrend: 'declining',
          },
          {
            avgDailySales: 1,
            currentStock: 2,
            daysOfStock: 2,
            productId: 'first',
            productName: 'First',
            salesTrend: 'stable',
          },
        ],
        pagination: { page: 1, total: 10_000, totalPages: 100 },
        summary: {
          critical: 1_500,
          outOfStock: 750,
          totalProducts: 10_000,
          warning: 2_000,
        },
      });
    });

    const result = await fetchAnalyticsCategoryData({
      category: 'inventory',
      from,
      merchantId,
      signal: new AbortController().signal,
      to,
    });

    expect(result.inventoryForecasts).toMatchObject([
      { days_of_stock: 0, product_id: 'second' },
      { days_of_stock: 2, product_id: 'first' },
    ]);
    expect(result.lowStockCount).toBe(3_500);
    expect(result.outOfStockCount).toBe(750);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain(
      '/api/inventory/forecast?limit=100'
    );
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toEqual(
      expect.arrayContaining([expect.stringContaining('page=')])
    );
  });

  it('preserves forecast status and threshold for low-stock widget classification', async () => {
    fetchMock.mockImplementation(async () =>
      response({
        forecasts: [
          {
            avgDailySales: 0,
            currentStock: 2,
            daysOfStock: 999,
            lowStockThreshold: 2,
            productId: 'threshold-critical',
            productName: 'Threshold-critical product',
            salesTrend: 'stable',
            status: 'critical',
          },
        ],
        summary: { critical: 1, outOfStock: 0, warning: 0 },
      })
    );

    const result = await fetchAnalyticsCategoryData({
      category: 'inventory',
      from,
      merchantId,
      signal: new AbortController().signal,
      to,
    });

    expect(result.inventoryForecasts).toEqual([
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
    ]);
  });

  it('keeps out-of-stock forecasts ahead of finite-day products', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/inventory/forecast')) {
        return response({
          forecasts: [
            {
              avgDailySales: 1,
              currentStock: 2,
              daysOfStock: 2,
              productId: 'finite-days',
              productName: 'Finite-days product',
              salesTrend: 'stable',
              status: 'healthy',
            },
            {
              avgDailySales: 0,
              currentStock: 0,
              daysOfStock: 999,
              productId: 'out-of-stock',
              productName: 'Out-of-stock product',
              salesTrend: 'stable',
              status: 'out_of_stock',
            },
          ],
          summary: { critical: 0, outOfStock: 1, warning: 0 },
        });
      }

      return response({ alerts: [], stats: { total: 0 } });
    });

    const result = await fetchAnalyticsCategoryData({
      category: 'inventory',
      from,
      merchantId,
      signal: new AbortController().signal,
      to,
    });

    expect(
      result.inventoryForecasts?.map((forecast) => forecast.product_id)
    ).toEqual(['out-of-stock', 'finite-days']);
  });

  it('maps the customer segment summary into dashboard segment metrics', async () => {
    fetchMock.mockResolvedValue(
      response({
        summary: [
          {
            avg_clv: 300,
            customer_count: 2,
            segment_name: 'Champions',
            total_revenue: 900,
          },
          {
            avg_clv: 80,
            customer_count: 3,
            segment_name: 'At Risk',
            total_revenue: 240,
          },
        ],
      })
    );

    await expect(
      fetchAnalyticsCategoryData({
        category: 'segments',
        from,
        merchantId,
        signal: new AbortController().signal,
        to,
      })
    ).resolves.toMatchObject({
      segmentSummary: {
        at_risk_count: 3,
        champions_count: 2,
        segments: expect.arrayContaining([
          expect.objectContaining({ segment: 'Champions', total_revenue: 900 }),
        ]),
        total_customers: 5,
      },
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/customers/segments?limit=100'
    );
  });

  it('weights CLV across every segment included in the at-risk count', async () => {
    fetchMock.mockResolvedValue(
      response({
        summary: [
          {
            avg_clv: 80,
            customer_count: 3,
            segment_name: 'At Risk',
            total_revenue: 240,
          },
          {
            avg_clv: 20,
            customer_count: 1,
            segment_name: "Can't Lose Them",
            total_revenue: 20,
          },
        ],
      })
    );

    await expect(
      fetchAnalyticsCategoryData({
        category: 'segments',
        from,
        merchantId,
        signal: new AbortController().signal,
        to,
      })
    ).resolves.toMatchObject({
      segmentSummary: {
        at_risk_avg_clv: 65,
        at_risk_count: 4,
      },
    });
  });

  it('loads ad conversion analytics for the selected date range', async () => {
    fetchMock.mockResolvedValue(
      response({
        configuredPlatforms: 2,
        details: {
          ordersWithClickIds: 4,
          ordersWithLDU: 1,
          ordersWithTracking: 5,
        },
        offlineConversionsEnabled: true,
        googleAds: {
          accountName: 'Baci reporting account',
          connectionStatus: 'connected',
          currency: 'NGN',
          metrics: {
            clicks: 48,
            ctr: 2.4,
            impressions: 2000,
            spend: 12500,
          },
        },
        platforms: [
          {
            clickAttributed: 4,
            configured: true,
            conversions: 2,
            name: 'Facebook',
            revenue: 500,
          },
        ],
        socialAds: {
          attributionNotice: 'Provider attribution stays separate.',
          mixedCurrencies: false,
          providers: [
            {
              accountName: 'Baci Meta',
              accountTimezone: 'Africa/Lagos',
              clicksLabel: 'Clicks',
              connectionStatus: 'connected',
              conversionsLabel: 'Meta-attributed conversions',
              dataStatus: 'ready',
              displayName: 'Meta Ads',
              freshness: 'fresh',
              isStale: false,
              lastSyncedAt: '2026-08-22T09:00:00.000Z',
              metrics: {
                clicks: '20',
                conversions: '2',
                endDate: '2026-08-22',
                impressions: '1000',
                reach: '800',
                spendByCurrency: [
                  { currencyCode: 'NGN', spendAmountDecimal: '12500.50' },
                ],
                startDate: '2026-08-01',
              },
              needsAccountSelection: false,
              provider: 'meta_ads',
            },
          ],
          spendByCurrency: [
            { currencyCode: 'NGN', spendAmountDecimal: '12500.50' },
          ],
        },
        summary: {
          clickAttributionRate: 40,
          lduRate: 10,
          totalAttributedRevenue: 500,
          totalConversions: 2,
          totalOrders: 10,
          trackingRate: 50,
        },
      })
    );

    const result = await fetchAnalyticsCategoryData({
      category: 'ads',
      from,
      merchantId,
      signal: new AbortController().signal,
      to,
    });

    expect(result.adAnalytics?.summary.totalConversions).toBe(2);
    expect(result.adAnalytics?.details.ordersWithTracking).toBe(5);
    expect(result.adAnalytics?.googleAds).toMatchObject({
      accountName: 'Baci reporting account',
      connectionStatus: 'connected',
      currency: 'NGN',
      metrics: {
        clicks: 48,
        ctr: 2.4,
        impressions: 2000,
        spend: 12500,
      },
    });
    expect(result.adAnalytics?.platforms[0]?.name).toBe('Facebook');
    expect(result.adAnalytics?.socialAds).toMatchObject({
      mixedCurrencies: false,
      providers: [
        {
          metrics: {
            conversions: '2',
            spendByCurrency: [
              { currencyCode: 'NGN', spendAmountDecimal: '12500.50' },
            ],
          },
          provider: 'meta_ads',
        },
      ],
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain('/api/analytics/ads?');
    expect(String(url)).toContain(`startDate=${localCalendarDate(from)}`);
    expect(String(url)).toContain(`endDate=${localCalendarDate(to)}`);
    expect(init).toEqual(
      expect.objectContaining({
        headers: { 'x-baci-merchant-id': merchantId },
      })
    );
  });

  it('maps the analytics snapshot daily rows into Google Ads reporting metrics', async () => {
    fetchMock.mockResolvedValue(
      response({
        googleAds: {
          connected: true,
          currencyCode: 'NGN',
          customerId: null,
          daily: [
            {
              clicks: 12,
              conversions: 2,
              currencyCode: 'NGN',
              date: '2026-08-20',
              fetchedAt: '2026-08-21T10:00:00.000Z',
              impressions: 1200,
              spend: 500,
              spendMicros: '500000000',
            },
          ],
          lastSyncedAt: null,
        },
      })
    );

    const result = await fetchAnalyticsCategoryData({
      category: 'ads',
      from,
      merchantId,
      signal: new AbortController().signal,
      to,
    });

    expect(result.adAnalytics?.googleAds).toMatchObject({
      connectionStatus: 'connected',
      currency: 'NGN',
      needsAccountSelection: true,
      metrics: {
        clicks: 12,
        conversions: 2,
        impressions: 1200,
        spend: 500,
      },
    });
  });

  it('adds a cache-bust token when ad reporting is refreshed', async () => {
    fetchMock.mockResolvedValue(response({}));

    await fetchAnalyticsCategoryData({
      category: 'ads',
      from,
      merchantId,
      refreshKey: 3,
      signal: new AbortController().signal,
      to,
    });

    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain('cacheBust=3');
  });

  it('sends date-picker calendar dates instead of UTC instants', async () => {
    fetchMock.mockResolvedValue(response({}));
    const localFrom = new Date(2026, 7, 1, 0, 0, 0);
    const localTo = new Date(2026, 7, 2, 23, 59, 59);
    const expectedOrderEnd = new Date(localTo);
    expectedOrderEnd.setHours(23, 59, 59, 999);

    await fetchAnalyticsCategoryData({
      category: 'ads',
      from: localFrom,
      merchantId,
      signal: new AbortController().signal,
      to: localTo,
    });

    const [url] = fetchMock.mock.calls[0] ?? [];
    const requestUrl = new URL(String(url), 'http://localhost');
    expect(requestUrl.searchParams.get('startDate')).toBe('2026-08-01');
    expect(requestUrl.searchParams.get('endDate')).toBe('2026-08-02');
    expect(requestUrl.searchParams.get('orderStart')).toBe(
      localFrom.toISOString()
    );
    expect(requestUrl.searchParams.get('orderEnd')).toBe(
      expectedOrderEnd.toISOString()
    );
  });

  it('extends a date-only selection to local end of day for order attribution', async () => {
    fetchMock.mockResolvedValue(response({}));
    const localTo = new Date(2026, 7, 2, 0, 0, 0, 0);
    const expectedOrderEnd = new Date(localTo);
    expectedOrderEnd.setHours(23, 59, 59, 999);

    await fetchAnalyticsCategoryData({
      category: 'ads',
      from: new Date(2026, 7, 1, 0, 0, 0, 0),
      merchantId,
      signal: new AbortController().signal,
      to: localTo,
    });

    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain(
      `orderEnd=${encodeURIComponent(expectedOrderEnd.toISOString())}`
    );
  });

  it('preserves mixed-currency and stale social reporting without changing legacy attribution', async () => {
    fetchMock.mockResolvedValue(
      response({
        platforms: [
          {
            clickAttributed: 3,
            configured: true,
            conversions: 1,
            name: 'TikTok',
            revenue: 5000,
          },
        ],
        socialAds: {
          attributionNotice: 'Provider attribution stays separate.',
          mixedCurrencies: true,
          providers: [
            {
              connectionStatus: 'connected',
              dataStatus: 'ready',
              displayName: 'TikTok Ads',
              freshness: 'stale',
              isStale: true,
              provider: 'tiktok_ads',
            },
          ],
          spendByCurrency: [
            { currencyCode: 'NGN', spendAmountDecimal: '2000' },
            { currencyCode: 'USD', spendAmountDecimal: '5' },
          ],
        },
      })
    );

    const result = await fetchAnalyticsCategoryData({
      category: 'ads',
      from,
      merchantId,
      signal: new AbortController().signal,
      to,
    });

    expect(result.adAnalytics?.platforms[0]).toMatchObject({
      clickAttributed: 3,
      revenue: 5000,
    });
    expect(result.adAnalytics?.socialAds).toMatchObject({
      mixedCurrencies: true,
      providers: [expect.objectContaining({ freshness: 'stale' })],
      spendByCurrency: [
        { currencyCode: 'NGN', spendAmountDecimal: '2000' },
        { currencyCode: 'USD', spendAmountDecimal: '5' },
      ],
    });
  });

  it('does not fetch specialized data for categories backed by the base overview', async () => {
    const result = await fetchAnalyticsCategoryData({
      category: 'overview',
      from,
      merchantId,
      signal: new AbortController().signal,
      to,
    });

    expect(result).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

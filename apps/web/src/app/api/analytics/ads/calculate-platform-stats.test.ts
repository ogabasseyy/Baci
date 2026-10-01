import { describe, expect, it } from 'vitest';
import { calculatePlatformStats } from './calculate-platform-stats';

const configuredMerchant = {
  facebook_capi_token: 'facebook-token',
  facebook_pixel_id: 'facebook-pixel',
  ga4_api_secret: 'ga4-secret',
  google_analytics_id: 'G-TEST',
  snapchat_capi_token: 'snapchat-token',
  snapchat_pixel_id: 'snapchat-pixel',
  tiktok_access_token: 'tiktok-token',
  tiktok_pixel_id: 'tiktok-pixel',
} as const;

describe('calculatePlatformStats', () => {
  it('counts configured platform attribution and privacy details', () => {
    const result = calculatePlatformStats(
      [
        {
          ad_tracking: { fbclid: 'fb-click', limitedDataUse: true },
          created_at: '2026-08-01T00:00:00.000Z',
          id: 'order-1',
          payment_status: 'paid',
          total: 125,
        },
        {
          ad_tracking: { gclid: 'google-click' },
          created_at: '2026-08-01T00:00:00.000Z',
          id: 'order-2',
          payment_status: 'paid',
          total: 75,
        },
        {
          ad_tracking: null,
          created_at: '2026-08-01T00:00:00.000Z',
          id: 'order-3',
          payment_status: 'paid',
          total: 50,
        },
      ],
      configuredMerchant
    );

    expect(result.configuredPlatforms).toBe(4);
    expect(result.totalConversions).toBe(2);
    expect(result.totalAttributedRevenue).toBe(200);
    expect(result.details).toEqual({
      ordersWithClickIds: 2,
      ordersWithLDU: 1,
      ordersWithTracking: 2,
    });
    expect(result.platformStats.facebook).toMatchObject({
      clickAttributed: 1,
      conversions: 1,
      revenue: 125,
    });
    expect(result.platformStats.ga4).toMatchObject({
      clickAttributed: 1,
      conversions: 1,
      revenue: 75,
    });
  });

  it('keeps click attribution visible without counting an unconfigured platform', () => {
    const result = calculatePlatformStats(
      [
        {
          ad_tracking: { ttclid: 'tiktok-click' },
          created_at: '2026-08-01T00:00:00.000Z',
          id: 'order-1',
          payment_status: 'paid',
          total: 90,
        },
      ],
      {
        ...configuredMerchant,
        tiktok_access_token: null,
        tiktok_pixel_id: null,
      }
    );

    expect(result.totalConversions).toBe(0);
    expect(result.totalAttributedRevenue).toBe(0);
    expect(result.platformStats.tiktok).toMatchObject({
      clickAttributed: 1,
      configured: false,
      conversions: 0,
      revenue: 0,
    });
  });

  it('does not count browser identifiers as click attribution', () => {
    const result = calculatePlatformStats(
      [
        {
          ad_tracking: {
            fbp: 'fb-browser',
            gaClientId: '123.456',
            ttp: 'tt-browser',
          },
          created_at: '2026-08-01T00:00:00.000Z',
          id: 'order-1',
          payment_status: 'paid',
          total: 90,
        },
      ],
      configuredMerchant
    );

    expect(result.details.ordersWithClickIds).toBe(0);
    expect(result.platformStats.facebook.clickAttributed).toBe(0);
    expect(result.platformStats.tiktok.clickAttributed).toBe(0);
    expect(result.platformStats.ga4.clickAttributed).toBe(0);
    expect(result.totalConversions).toBe(0);
    expect(result.totalAttributedRevenue).toBe(0);
    expect(result.platformStats.facebook.conversions).toBe(0);
    expect(result.platformStats.tiktok.conversions).toBe(0);
    expect(result.platformStats.ga4.conversions).toBe(0);
  });

  it('does not count discount provenance without attribution as tracked', () => {
    const result = calculatePlatformStats(
      [
        {
          ad_tracking: {
            baci_transaction_discount: {
              lineDiscounts: [],
              version: 3,
            },
          },
          created_at: '2026-08-01T00:00:00.000Z',
          id: 'order-discount-only',
          payment_status: 'paid',
          total: 90,
        },
      ],
      configuredMerchant
    );

    expect(result.details).toEqual({
      ordersWithClickIds: 0,
      ordersWithLDU: 0,
      ordersWithTracking: 0,
    });
  });
});

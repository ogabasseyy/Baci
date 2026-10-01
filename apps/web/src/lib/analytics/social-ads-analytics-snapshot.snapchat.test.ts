import { describe, expect, it } from 'vitest';
import { buildSocialAdsAnalyticsSnapshot } from './social-ads-analytics-snapshot';

const NOW = new Date('2026-08-22T10:00:00.000Z');
const EXPIRED_AT = '2026-08-22T09:00:00.000Z';

function buildExpiredProviderSnapshot(
  provider: 'meta_ads' | 'snapchat_ads' | 'tiktok_ads'
) {
  return buildSocialAdsAnalyticsSnapshot({
    connections: [
      {
        account_timezone: 'UTC',
        last_synced_at: '2026-08-22T09:30:00.000Z',
        provider,
        provider_account_label: 'Baci Ads',
        provider_customer_id: 'account-1',
        status: 'active',
        token_expires_at: EXPIRED_AT,
      },
    ],
    endDate: '2026-08-22',
    now: NOW,
    spendRows: [
      {
        account_timezone: 'UTC',
        clicks: '10',
        conversions: '1',
        currency_code: 'NGN',
        fetched_at: '2026-08-22T09:30:00.000Z',
        impressions: '100',
        provider,
        provider_customer_id: 'account-1',
        reach: '80',
        spend_amount_decimal: '100',
        spend_date: '2026-08-22',
      },
    ],
    startDate: '2026-08-22',
  });
}

describe('buildSocialAdsAnalyticsSnapshot Snapchat token refresh', () => {
  it('keeps an active Snapchat connection and its metrics available after its refreshable access token expires', () => {
    const snapshot = buildExpiredProviderSnapshot('snapchat_ads');
    const snapchat = snapshot.providers.find(
      (provider) => provider.provider === 'snapchat_ads'
    );

    expect(snapchat).toMatchObject({
      connectionStatus: 'connected',
      error: null,
      freshness: 'fresh',
      metrics: {
        clicks: '10',
        conversions: '1',
        impressions: '100',
        spendByCurrency: [{ currencyCode: 'NGN', spendAmountDecimal: '100' }],
      },
      needsAccountSelection: false,
    });
    expect(snapshot.spendByCurrency).toEqual([
      { currencyCode: 'NGN', spendAmountDecimal: '100' },
    ]);
  });

  it.each([
    'meta_ads',
    'tiktok_ads',
  ] as const)('keeps expired %s connections unavailable when no refresh-on-sync path exists', (provider) => {
    const snapshot = buildExpiredProviderSnapshot(provider);
    const providerSnapshot = snapshot.providers.find(
      (candidate) => candidate.provider === provider
    );

    expect(providerSnapshot).toMatchObject({
      connectionStatus: 'error',
      error: 'This connection needs to be reauthorized.',
      freshness: 'not_applicable',
      metrics: null,
    });
    expect(snapshot.spendByCurrency).toEqual([]);
  });
});

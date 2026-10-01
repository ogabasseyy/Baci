import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  type SocialAdsProviderReporting,
  SocialAdsReportingCard,
} from './social-ads-reporting-card';

vi.mock('./social-ads-account-controls', () => ({
  SocialAdsAccountControls: ({
    displayName,
    merchantId,
  }: {
    displayName: string;
    merchantId?: string;
  }) => (
    <button type="button">
      Sync {displayName} {merchantId}
    </button>
  ),
}));

function provider(
  overrides: Partial<SocialAdsProviderReporting>
): SocialAdsProviderReporting {
  return {
    accountName: 'Reporting account',
    accountTimezone: 'Africa/Lagos',
    clicksLabel: 'Clicks',
    connectionStatus: 'connected',
    conversionsLabel: 'Provider-attributed conversions',
    dataStatus: 'ready',
    displayName: 'Meta Ads',
    error: null,
    freshness: 'fresh',
    isStale: false,
    lastSyncedAt: '2026-08-22T09:00:00.000Z',
    metrics: null,
    needsAccountSelection: false,
    provider: 'meta_ads',
    ...overrides,
  };
}

describe('SocialAdsReportingCard', () => {
  const merchantId = '123e4567-e89b-42d3-a456-426614174000';
  const reportingProps = { canManageIntegrations: true, merchantId };

  it('hides provider management controls from analytics-only staff', () => {
    render(
      <SocialAdsReportingCard
        canManageIntegrations={false}
        merchantId={merchantId}
        reporting={{
          attributionNotice: 'Separate attribution.',
          mixedCurrencies: false,
          providers: [
            provider({
              connectionStatus: 'disconnected',
              displayName: 'TikTok Ads',
              provider: 'tiktok_ads',
            }),
          ],
          spendByCurrency: [],
        }}
      />
    );

    expect(
      screen.queryByRole('link', { name: /connect tiktok ads/i })
    ).not.toBeInTheDocument();
  });
  it('renders provider metrics without combining currencies or claiming ROAS', () => {
    render(
      <SocialAdsReportingCard
        {...reportingProps}
        reporting={{
          attributionNotice:
            'Provider conversions are separate from Baci paid orders.',
          mixedCurrencies: true,
          providers: [
            provider({
              conversionsLabel: 'Meta-attributed conversions',
              metrics: {
                clicks: '25',
                conversions: '2',
                endDate: '2026-08-22',
                impressions: '1000',
                reach: '800',
                spendByCurrency: [
                  { currencyCode: 'NGN', spendAmountDecimal: '12500.50' },
                ],
                startDate: '2026-08-01',
              },
            }),
          ],
          spendByCurrency: [
            { currencyCode: 'NGN', spendAmountDecimal: '12500.50' },
            { currencyCode: 'USD', spendAmountDecimal: '10' },
          ],
        }}
      />
    );

    expect(screen.getByText(/multiple currencies/i)).toBeInTheDocument();
    expect(screen.getByText(/Total NGN\s12,500\.50/)).toBeInTheDocument();
    expect(screen.getByText('Total $10.00')).toBeInTheDocument();
    expect(screen.getByText('Meta-attributed conversions')).toBeInTheDocument();
    expect(
      screen.getByText(/does not calculate social-ad ROAS/i)
    ).toBeInTheDocument();
  });

  it('renders stale, disconnected, error, and account-selection states', () => {
    render(
      <SocialAdsReportingCard
        {...reportingProps}
        reporting={{
          attributionNotice: 'Separate attribution.',
          mixedCurrencies: false,
          providers: [
            provider({
              dataStatus: 'error',
              error: 'Reporting data is temporarily unavailable.',
              freshness: 'stale',
              isStale: true,
            }),
            provider({
              accountName: null,
              connectionStatus: 'disconnected',
              displayName: 'TikTok Ads',
              provider: 'tiktok_ads',
            }),
            provider({
              connectionStatus: 'error',
              displayName: 'Snapchat Ads',
              error: 'This connection needs to be reauthorized.',
              provider: 'snapchat_ads',
            }),
          ],
          spendByCurrency: [],
        }}
      />
    );

    expect(screen.getByText(/Reporting is stale/i)).toBeInTheDocument();
    expect(
      screen.getByText('Reporting data is temporarily unavailable.')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Connect TikTok Ads/i })
    ).toHaveAttribute(
      'href',
      `/api/integrations/ads/tiktok/connect?merchantId=${merchantId}`
    );
    expect(
      screen.getByRole('link', { name: /Reconnect Snapchat Ads/i })
    ).toHaveAttribute(
      'href',
      `/api/integrations/ads/snapchat/connect?merchantId=${merchantId}`
    );
    expect(
      screen.getByRole('button', {
        name: `Sync Meta Ads ${merchantId}`,
      })
    ).toBeInTheDocument();
  });
});

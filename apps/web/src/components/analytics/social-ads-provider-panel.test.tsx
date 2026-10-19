import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  formatSocialAdsCount,
  formatSocialAdsSpend,
  SocialAdsProviderPanel,
} from './social-ads-provider-panel';
import type {
  SocialAdsProvider,
  SocialAdsProviderReporting,
} from './social-ads-reporting-card';

describe('social ads provider panel formatting', () => {
  it('formats safe counts and preserves high-precision spend', () => {
    expect(formatSocialAdsCount('1234')).toBe('1,234');
    expect(formatSocialAdsCount('not-a-number')).toBe('not-a-number');
    expect(
      formatSocialAdsSpend({
        currencyCode: 'USD',
        spendAmountDecimal: '9007199254740993.123456',
      })
    ).toBe('USD 9007199254740993.123456');
  });

  it('uses each currency standard minor-unit precision', () => {
    expect(
      formatSocialAdsSpend({
        currencyCode: 'KWD',
        spendAmountDecimal: '1.234',
      })
    ).toBe(
      new Intl.NumberFormat('en-US', {
        currency: 'KWD',
        style: 'currency',
      }).format(1.234)
    );
    expect(
      formatSocialAdsSpend({
        currencyCode: 'USD',
        spendAmountDecimal: '1.2',
      })
    ).toBe('$1.20');
    expect(
      formatSocialAdsSpend({
        currencyCode: 'USD',
        spendAmountDecimal: '0',
      })
    ).toBe('$0.00');
  });
});

const providerPath = {
  meta_ads: 'Meta Ads',
  snapchat_ads: 'Snapchat Ads',
  tiktok_ads: 'TikTok Ads',
} satisfies Record<SocialAdsProvider, string>;

function reporting(
  provider: SocialAdsProvider,
  connectionStatus: 'connected' | 'error',
  overrides: Partial<SocialAdsProviderReporting> = {}
): SocialAdsProviderReporting {
  return {
    accountName: 'Reporting account',
    accountTimezone: 'Africa/Lagos',
    clicksLabel: 'Clicks',
    connectionStatus,
    conversionsLabel: 'Provider-attributed conversions',
    dataStatus: 'ready',
    displayName: providerPath[provider],
    error: connectionStatus === 'error' ? 'Reconnect required.' : null,
    freshness: 'fresh',
    isStale: false,
    lastSyncedAt: null,
    metrics: null,
    needsAccountSelection: false,
    provider,
    ...overrides,
  };
}

describe('SocialAdsProviderPanel disconnect controls', () => {
  it.each(
    Object.keys(providerPath) as SocialAdsProvider[]
  )('offers disconnect for connected and error %s accounts', (provider) => {
    const { rerender } = render(
      <SocialAdsProviderPanel
        canManageIntegrations
        provider={reporting(provider, 'connected')}
      />
    );

    expect(
      screen.getByRole('button', {
        name: `Disconnect ${providerPath[provider]}`,
      })
    ).toBeInTheDocument();

    rerender(
      <SocialAdsProviderPanel
        canManageIntegrations
        provider={reporting(provider, 'error')}
      />
    );
    expect(
      screen.getByRole('button', {
        name: `Disconnect ${providerPath[provider]}`,
      })
    ).toBeInTheDocument();
  });

  it('hides disconnect from staff without integration management permission', () => {
    render(
      <SocialAdsProviderPanel
        canManageIntegrations={false}
        provider={reporting('meta_ads', 'connected')}
      />
    );

    expect(
      screen.queryByRole('button', { name: /disconnect meta ads/i })
    ).not.toBeInTheDocument();
  });

  it('uses a retry state and hides credential actions when reporting reads fail', () => {
    const onRetry = vi.fn();
    render(
      <SocialAdsProviderPanel
        canManageIntegrations
        onSynced={onRetry}
        provider={reporting('meta_ads', 'error', {
          dataStatus: 'error',
          error: 'Reporting data is temporarily unavailable.',
        })}
      />
    );

    expect(
      screen.getByText('Reporting data is temporarily unavailable.')
    ).toBeInTheDocument();
    expect(screen.getByText('Reporting unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Needs attention')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Retry Meta Ads reporting' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /reconnect meta ads/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /disconnect meta ads/i })
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Retry Meta Ads reporting' })
    );
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

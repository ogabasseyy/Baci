import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const receivedProps = vi.hoisted(() => ({
  google: null as Record<string, unknown> | null,
  social: null as Record<string, unknown> | null,
}));

vi.mock('./google-ads-reporting-card', () => ({
  GoogleAdsReportingCard: (props: Record<string, unknown>) => {
    receivedProps.google = props;
    return <div>Google Ads reporting</div>;
  },
}));

vi.mock('./social-ads-reporting-card', () => ({
  SocialAdsReportingCard: (props: Record<string, unknown>) => {
    receivedProps.social = props;
    return <div>Social Ads reporting</div>;
  },
}));

import { renderAdsAnalyticsWidgets } from './ads-analytics-widgets';

const adAnalytics = {
  configuredPlatforms: 2,
  details: {
    ordersWithClickIds: 3,
    ordersWithLDU: 1,
    ordersWithTracking: 4,
  },
  offlineConversionsEnabled: true,
  platforms: [
    {
      clickAttributed: 2,
      configured: true,
      conversions: 2,
      name: 'Google Ads',
      revenue: 100,
    },
  ],
  summary: {
    clickAttributionRate: 50,
    lduRate: 25,
    totalAttributedRevenue: 100,
    totalConversions: 2,
    totalOrders: 4,
    totalRoas: 2,
    totalSpend: 50,
    trackingRate: 75,
  },
};

describe('AdsAnalyticsWidgets', () => {
  it('keeps all six ads widgets in the editable grid', () => {
    render(
      <div>
        {renderAdsAnalyticsWidgets({
          adAnalytics,
          canManageIntegrations: false,
          editMode: true,
          formatCurrency: (value) => `NGN ${value}`,
          isWidgetVisible: () => true,
        })}
      </div>
    );

    expect(screen.getByText('Conversion Overview')).toBeInTheDocument();
    expect(screen.getByText('Platform Performance')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Click Attribution' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Privacy Compliance' })
    ).toBeInTheDocument();
    expect(screen.getByText(/Google Ads reporting/i)).toBeInTheDocument();
    expect(screen.getByText(/Social Ads reporting/i)).toBeInTheDocument();
  });

  it('omits hidden ads widgets in either layout mode', () => {
    render(
      <div>
        {renderAdsAnalyticsWidgets({
          adAnalytics,
          canManageIntegrations: false,
          formatCurrency: (value) => `NGN ${value}`,
          isWidgetVisible: (widgetId) => widgetId === 'ads-overview',
        })}
      </div>
    );

    expect(screen.getByText('Conversion Overview')).toBeInTheDocument();
    expect(screen.queryByText('Platform Performance')).not.toBeInTheDocument();
    expect(screen.queryByText('Click Attribution')).not.toBeInTheDocument();
    expect(screen.queryByText('Privacy Compliance')).not.toBeInTheDocument();
  });

  it('forwards the selected merchant and its authoritative integration permission', () => {
    render(
      <div>
        {renderAdsAnalyticsWidgets({
          adAnalytics,
          canManageIntegrations: false,
          formatCurrency: (value) => `GHS ${value}`,
          isWidgetVisible: () => true,
          merchantId: '123e4567-e89b-42d3-a456-426614174000',
        })}
      </div>
    );

    expect(receivedProps.google).toMatchObject({
      canManageIntegrations: false,
      merchantId: '123e4567-e89b-42d3-a456-426614174000',
    });
    expect(receivedProps.social).toMatchObject({
      canManageIntegrations: false,
      merchantId: '123e4567-e89b-42d3-a456-426614174000',
    });
  });
});

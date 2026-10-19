import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GoogleAdsReportingMetricsGrid } from './google-ads-reporting-metrics-grid';

describe('GoogleAdsReportingMetricsGrid', () => {
  it('renders only provider-supplied metrics', () => {
    render(
      <GoogleAdsReportingMetricsGrid
        currency="NGN"
        metrics={{
          clicks: 48,
          ctr: 2.4,
          impressions: 2000,
          spend: 12500,
        }}
      />
    );

    expect(screen.getByText('Spend')).toBeInTheDocument();
    expect(screen.getByText('Impressions')).toBeInTheDocument();
    expect(screen.getByText('Clicks')).toBeInTheDocument();
    expect(screen.getByText('CTR')).toBeInTheDocument();
    expect(screen.queryByText('CPC')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Google-attributed conversions')
    ).not.toBeInTheDocument();
  });
});

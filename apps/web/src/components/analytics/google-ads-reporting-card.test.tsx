import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetchWithCsrf } = vi.hoisted(() => ({
  mockFetchWithCsrf: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: mockFetchWithCsrf,
}));

import {
  GOOGLE_ADS_CONNECT_PATH,
  GoogleAdsReportingCard,
} from './google-ads-reporting-card';

describe('GoogleAdsReportingCard', () => {
  const merchantId = '123e4567-e89b-42d3-a456-426614174000';
  const reportingProps = { canManageIntegrations: true, merchantId };
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    mockFetchWithCsrf.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('offers a connect action when the reporting account is disconnected', () => {
    render(<GoogleAdsReportingCard {...reportingProps} />);

    expect(
      screen.getByText(/connect a google ads reporting account/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /connect google ads/i })
    ).toHaveAttribute(
      'href',
      `${GOOGLE_ADS_CONNECT_PATH}?merchantId=${merchantId}`
    );
  });

  it('keeps loading state explicit and does not show metric values', () => {
    render(<GoogleAdsReportingCard {...reportingProps} loading />);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Loading Google Ads reporting'
    );
    expect(screen.queryByText('Spend')).not.toBeInTheDocument();
  });

  it('hides management controls from analytics-only staff', () => {
    render(
      <GoogleAdsReportingCard
        canManageIntegrations={false}
        merchantId={merchantId}
      />
    );

    expect(
      screen.queryByRole('link', { name: /connect google ads/i })
    ).not.toBeInTheDocument();
  });

  it('offers reconnect only for a confirmed connection error', () => {
    render(
      <GoogleAdsReportingCard
        {...reportingProps}
        reporting={{
          connectionStatus: 'error',
          dataStatus: 'ready',
          error: 'Google Ads reporting is temporarily unavailable.',
        }}
      />
    );

    expect(
      screen.getByText('Google Ads reporting is temporarily unavailable.')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /reconnect google ads/i })
    ).toHaveAttribute(
      'href',
      `${GOOGLE_ADS_CONNECT_PATH}?merchantId=${merchantId}`
    );
  });

  it('shows retry-only unavailable state when reporting data reads fail', () => {
    const onSynced = vi.fn();

    render(
      <GoogleAdsReportingCard
        {...reportingProps}
        onSynced={onSynced}
        reporting={{
          connectionStatus: 'error',
          dataStatus: 'error',
          error: 'Google Ads reporting is temporarily unavailable.',
        }}
      />
    );

    expect(
      screen.getByRole('button', { name: 'Retry Google Ads reporting' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /reconnect google ads/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /select google ads account/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /disconnect google ads/i })
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Retry Google Ads reporting' })
    );
    expect(onSynced).toHaveBeenCalledOnce();
  });

  it('hides account controls while connected reporting reads are unavailable', () => {
    const onSynced = vi.fn();

    render(
      <GoogleAdsReportingCard
        {...reportingProps}
        onSynced={onSynced}
        reporting={{
          connectionStatus: 'connected',
          dataStatus: 'error',
          error: 'Google Ads reporting is temporarily unavailable.',
        }}
      />
    );

    expect(
      screen.getByRole('button', { name: 'Retry Google Ads reporting' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /select google ads account/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /disconnect google ads/i })
    ).not.toBeInTheDocument();
  });

  it('does not imply reporting is ready before an account is selected', () => {
    render(
      <GoogleAdsReportingCard
        {...reportingProps}
        reporting={{
          connectionStatus: 'connected',
          dataStatus: 'ready',
          needsAccountSelection: true,
        }}
      />
    );

    expect(
      screen.getByText(/select a reporting account to start importing/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /select google ads account/i })
    ).toBeInTheDocument();
    expect(screen.queryByText('Spend')).not.toBeInTheDocument();
  });

  it('keeps account selection and sync controls available before the first sync', () => {
    render(
      <GoogleAdsReportingCard
        {...reportingProps}
        reporting={{
          accountName: 'Baci reporting account',
          connectionStatus: 'connected',
          dataStatus: 'ready',
        }}
      />
    );

    expect(
      screen.getByText(/metrics will appear after the first reporting sync/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /select google ads account/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /reconnect google ads/i })
    ).toBeInTheDocument();
  });

  it('forwards the sync callback after an account selection completes', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          accounts: [{ customerId: '1234567890', selected: false }],
        }),
        { status: 200 }
      )
    );
    mockFetchWithCsrf
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const onSynced = vi.fn();

    render(
      <GoogleAdsReportingCard
        {...reportingProps}
        onSynced={onSynced}
        reporting={{
          connectionStatus: 'connected',
          dataStatus: 'ready',
          needsAccountSelection: true,
        }}
        syncWindow={{ endDate: '2026-08-21', startDate: '2026-08-01' }}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: /select google ads account/i })
    );
    await screen.findByRole('radio', { name: /••••7890/i });
    fireEvent.click(screen.getByRole('button', { name: /save account/i }));

    await waitFor(() => expect(onSynced).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/integrations/ads/google/accounts',
      expect.objectContaining({
        headers: {
          'x-baci-merchant-id': merchantId,
        },
      })
    );
    expect(mockFetchWithCsrf).toHaveBeenNthCalledWith(
      2,
      '/api/integrations/ads/google/sync',
      expect.objectContaining({
        body: expect.stringContaining(
          '"endDate":"2026-08-21","startDate":"2026-08-01","finalChunk":true'
        ),
        headers: {
          'x-baci-merchant-id': merchantId,
        },
        method: 'POST',
      })
    );
  });

  it('renders only metrics supplied by the reporting provider', () => {
    render(
      <GoogleAdsReportingCard
        {...reportingProps}
        reporting={{
          accountName: 'Baci reporting account',
          connectionStatus: 'connected',
          currency: 'NGN',
          dataStatus: 'ready',
          metrics: {
            clicks: 48,
            conversions: 3,
            ctr: 2.4,
            impressions: 2000,
            spend: 12500,
          },
        }}
      />
    );

    expect(screen.getByText('Spend')).toBeInTheDocument();
    expect(screen.getByText('Impressions')).toBeInTheDocument();
    expect(screen.getByText('Clicks')).toBeInTheDocument();
    expect(screen.getByText('CTR')).toBeInTheDocument();
    expect(
      screen.getByText('Google-attributed conversions')
    ).toBeInTheDocument();
    expect(screen.queryByText('CPC')).not.toBeInTheDocument();
    expect(screen.queryByText('ROAS')).not.toBeInTheDocument();
    expect(
      screen.getByText('Source: Google Ads reporting')
    ).toBeInTheDocument();
  });

  it('keeps an existing account controllable and labels stale provider data', () => {
    render(
      <GoogleAdsReportingCard
        {...reportingProps}
        reporting={{
          connectionStatus: 'connected',
          currency: 'NGN',
          dataStatus: 'ready',
          isStale: true,
          metrics: {
            endDate: '2026-08-21',
            spend: 1000,
            startDate: '2026-08-01',
          },
        }}
      />
    );

    expect(
      screen.getByText(/reporting data may be stale/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /select google ads account/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText('Reporting window: 2026-08-01 – 2026-08-21')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /disconnect google ads/i })
    ).toBeInTheDocument();
  });
});

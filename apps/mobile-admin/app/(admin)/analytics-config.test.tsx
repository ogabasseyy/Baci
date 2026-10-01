import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AnalyticsConfigScreen,
  accessMocks,
  merchantAnalytics,
  mutationMocks,
  queryMocks,
  resetAnalyticsConfigMocks,
  supabaseMocks,
  THEME_TEXT,
  THEME_TEXT_ON_PRIMARY,
} from '../../__tests__/admin/analytics-config.test-support';

describe('AnalyticsConfigScreen — appearance and access', () => {
  beforeEach(resetAnalyticsConfigMocks);

  it('passes the theme text token to the TikTok PlatformCard icon, not hardcoded black', () => {
    render(<AnalyticsConfigScreen />);
    const tiktokIcon = screen.getByTestId('icon-logo-tiktok');
    expect(tiktokIcon).toHaveAttribute('data-color', THEME_TEXT);
    expect(tiktokIcon).not.toHaveAttribute('data-color', '#000000');
  });

  it('passes the textOnPrimary theme token to the offline-conversions toggle knob, not hardcoded white', () => {
    render(<AnalyticsConfigScreen />);
    const knob = screen.getByTestId('offline-conversions-toggle-knob');
    expect(knob).toHaveStyle({ backgroundColor: THEME_TEXT_ON_PRIMARY });
    expect(knob).not.toHaveStyle({ backgroundColor: '#fff' });
    expect(knob).not.toHaveStyle({ backgroundColor: '#ffffff' });
  });

  it('does not expose the shared merchant analytics fixture to component renders', () => {
    render(<AnalyticsConfigScreen />);
    const result = queryMocks.useQuery.mock.results[0]?.value as {
      data: { analytics: typeof merchantAnalytics };
    };
    result.data.analytics.tiktok_pixel_id = 'mutated-in-test';
    expect(result.data.analytics).not.toBe(merchantAnalytics);
    expect(merchantAnalytics.tiktok_pixel_id).toBe('');
  });

  it('does not fetch tracking credentials for RevenueCat-only users before DB entitlement syncs', () => {
    // RevenueCat can lead the DB entitlement projection; this screen waits for
    // the canonical merchant plan rather than exposing credentials early.
    accessMocks.useMerchant.mockReturnValue({
      isLoading: false,
      merchant: { plan_tier: 'free', premium_features: [] },
    });
    accessMocks.useRevenueCat.mockReturnValue({ isPro: true });
    render(<AnalyticsConfigScreen />);
    const options = queryMocks.useQuery.mock.calls.at(-1)?.[0] as {
      enabled?: boolean;
    };
    expect(options.enabled).toBe(false);
    expect(screen.getByText('Pro access is syncing')).toBeInTheDocument();
  });

  it('does not enable the tracking credentials query for locked free merchants', () => {
    accessMocks.useMerchant.mockReturnValue({
      isLoading: false,
      merchant: { plan_tier: 'free', premium_features: [] },
    });
    accessMocks.useRevenueCat.mockReturnValue({ isPro: false });
    render(<AnalyticsConfigScreen />);
    const options = queryMocks.useQuery.mock.calls.at(-1)?.[0] as {
      enabled?: boolean;
    };
    expect(options.enabled).toBe(false);
  });

  it('renders an error state with a working retry action when the credentials query fails', () => {
    const refetch = vi.fn();
    queryMocks.useQuery.mockReturnValueOnce({
      data: null,
      isError: true,
      isLoading: false,
      refetch,
    });
    render(<AnalyticsConfigScreen />);
    expect(
      screen.getByText("Couldn't load analytics settings")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText('Retry').closest('button') as Element);
    expect(refetch).toHaveBeenCalled();
  });

  it('blocks saving before analytics data has successfully seeded', async () => {
    queryMocks.useQuery.mockReturnValueOnce({
      data: null,
      isError: true,
      isLoading: false,
    });
    render(<AnalyticsConfigScreen />);
    await expect(mutationMocks.state.options?.mutationFn()).rejects.toThrow(
      'Analytics settings are still loading'
    );
    expect(supabaseMocks.update).not.toHaveBeenCalled();
  });
});

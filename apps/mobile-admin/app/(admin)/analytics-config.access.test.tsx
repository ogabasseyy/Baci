import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AnalyticsConfigScreen,
  alertMocks,
  merchantAnalytics,
  mutationMocks,
  queryMocks,
  resetAnalyticsConfigMocks,
  supabaseMocks,
} from '../../__tests__/admin/analytics-config.test-support';

describe('bugfix: tracking credentials load through the active merchant RPC (revoked-column 42501)', () => {
  beforeEach(resetAnalyticsConfigMocks);

  function captureQueryFn() {
    return (
      queryMocks.useQuery.mock.calls.at(-1)?.[0] as {
        queryFn: () => Promise<unknown>;
      }
    ).queryFn;
  }

  it('fetches credentials through the SECURITY DEFINER RPC, never selecting merchants columns directly', async () => {
    supabaseMocks.rpc.mockResolvedValue({
      data: {
        merchant: { ...merchantAnalytics, ga4_api_secret: 'owner-secret' },
        staffAccess: { isOwner: true, isStaff: false },
      },
      error: null,
    });
    render(<AnalyticsConfigScreen />);
    await expect(captureQueryFn()()).resolves.toMatchObject({
      analytics: { ga4_api_secret: 'owner-secret' },
      isOwner: true,
    });
    expect(supabaseMocks.rpc).toHaveBeenCalledWith(
      'get_merchant_analytics_config',
      { p_merchant_id: 'merchant-1' }
    );
    expect(supabaseMocks.from).not.toHaveBeenCalled();
  });

  it('shows the owner-only notice instead of the editable form for staff', () => {
    queryMocks.useQuery.mockReturnValue({
      data: {
        analytics: { ...merchantAnalytics, ga4_api_secret: null },
        isOwner: false,
      },
      isError: false,
      isLoading: false,
    });
    render(<AnalyticsConfigScreen />);
    expect(screen.getByText('Owner-only settings')).toBeInTheDocument();
    expect(
      screen.queryByText('Meta (Facebook/Instagram)')
    ).not.toBeInTheDocument();
  });

  it('rejects a staff save attempt without writing or reporting success', async () => {
    queryMocks.useQuery.mockReturnValue({
      data: { analytics: { ...merchantAnalytics }, isOwner: false },
      isError: false,
      isLoading: false,
    });
    render(<AnalyticsConfigScreen />);
    await expect(mutationMocks.state.options?.mutationFn()).rejects.toThrow(
      'Only the store owner can manage analytics credentials.'
    );
    expect(supabaseMocks.update).not.toHaveBeenCalled();
    expect(alertMocks.alert).not.toHaveBeenCalledWith(
      'Success',
      expect.anything()
    );
  });

  it('throws when the RPC reports an error', async () => {
    supabaseMocks.rpc.mockResolvedValue({
      data: null,
      error: new Error('rpc unavailable'),
    });
    render(<AnalyticsConfigScreen />);
    await expect(captureQueryFn()()).rejects.toThrow('rpc unavailable');
  });

  it('throws a merchant-not-found error when the RPC returns no context', async () => {
    render(<AnalyticsConfigScreen />);
    await expect(captureQueryFn()()).rejects.toThrow(
      'Merchant profile not found'
    );
  });
});

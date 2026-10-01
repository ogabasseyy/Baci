import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AnalyticsConfigScreen,
  merchantAnalytics,
  mutationMocks,
  queryMocks,
  resetAnalyticsConfigMocks,
  supabaseMocks,
} from '../../__tests__/admin/analytics-config.test-support';

const analyticsResult = (analytics = merchantAnalytics) => ({
  data: { analytics: { ...analytics }, isOwner: true },
  isError: false,
  isLoading: false,
});
const expandMetaCard = () =>
  fireEvent.click(
    screen.getByText('Meta (Facebook/Instagram)').closest('button') as Element
  );
const pixelInput = () =>
  screen.getByPlaceholderText('1234567890123456') as HTMLInputElement;
const queryOptions = () =>
  queryMocks.useQuery.mock.calls.at(-1)?.[0] as {
    refetchOnWindowFocus?: boolean;
    refetchOnReconnect?: boolean;
  };

describe('AnalyticsConfigScreen — dirty buffer and refetching', () => {
  beforeEach(resetAnalyticsConfigMocks);

  it('keeps a typed edit when a background refetch returns the original value, and saves only the edited field', async () => {
    queryMocks.useQuery.mockReturnValue(analyticsResult());
    const { rerender } = render(<AnalyticsConfigScreen />);
    expandMetaCard();
    fireEvent.change(pixelInput(), { target: { value: 'EDITED-PIXEL-123' } });
    queryMocks.useQuery.mockReturnValue(analyticsResult());
    rerender(<AnalyticsConfigScreen />);
    expect(pixelInput().value).toBe('EDITED-PIXEL-123');
    await mutationMocks.state.options?.mutationFn();
    expect(supabaseMocks.update).toHaveBeenCalledWith({
      facebook_pixel_id: 'EDITED-PIXEL-123',
    });
    expect(supabaseMocks.eq).toHaveBeenCalledWith('id', 'merchant-1');
  });

  it('reseeds from fresher analytics data while the form is still clean', () => {
    queryMocks.useQuery.mockReturnValue(analyticsResult());
    const { rerender } = render(<AnalyticsConfigScreen />);
    expandMetaCard();
    queryMocks.useQuery.mockReturnValue(
      analyticsResult({
        ...merchantAnalytics,
        facebook_pixel_id: 'FRESH-PIXEL-456',
      })
    );
    rerender(<AnalyticsConfigScreen />);
    expect(pixelInput().value).toBe('FRESH-PIXEL-456');
  });

  it('skips the write entirely when nothing changed (no-op save)', async () => {
    render(<AnalyticsConfigScreen />);
    await mutationMocks.state.options?.mutationFn();
    expect(supabaseMocks.update).not.toHaveBeenCalled();
  });

  it('keeps reconnect and focus refetching enabled while the query is errored and unseeded', () => {
    queryMocks.useQuery.mockReturnValue({
      data: null,
      isError: true,
      isLoading: false,
      refetch: vi.fn(),
    });
    render(<AnalyticsConfigScreen />);
    expect(queryOptions()).toMatchObject({
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    });
  });

  it('keeps reconnect and focus refetching enabled until the form becomes dirty', () => {
    const { rerender } = render(<AnalyticsConfigScreen />);
    expect(queryOptions()).toMatchObject({
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    });
    expandMetaCard();
    fireEvent.change(pixelInput(), { target: { value: 'EDITED-PIXEL-123' } });
    rerender(<AnalyticsConfigScreen />);
    expect(queryOptions()).toMatchObject({
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    });
  });
});

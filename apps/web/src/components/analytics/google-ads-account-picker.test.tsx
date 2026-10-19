import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetchWithCsrf = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: mockFetchWithCsrf,
}));

import { GoogleAdsAccountPicker } from './google-ads-account-picker';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status });
}

describe('GoogleAdsAccountPicker', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    mockFetchWithCsrf.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('discovers accounts and masks customer ids before rendering choices', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        accounts: [
          { customerId: '123-456-7890', selected: false },
          { customerId: '5556667777', selected: true },
        ],
      })
    );

    render(
      <GoogleAdsAccountPicker merchantId="550e8400-e29b-41d4-a716-446655440000" />
    );
    fireEvent.click(
      screen.getByRole('button', { name: /select google ads account/i })
    );

    expect(
      await screen.findByRole('radio', { name: /••••7890/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: /••••7777/i })
    ).toBeInTheDocument();
    expect(screen.queryByText('123-456-7890')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/integrations/ads/google/accounts',
      expect.objectContaining({
        credentials: 'include',
        headers: {
          'x-baci-merchant-id': '550e8400-e29b-41d4-a716-446655440000',
        },
      })
    );
  });

  it('PATCHes the selected account and starts a spend sync without exposing tokens', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        accounts: [{ customerId: '1234567890', selected: false }],
      })
    );
    mockFetchWithCsrf
      .mockResolvedValueOnce(jsonResponse({ selected: true }))
      .mockResolvedValueOnce(jsonResponse({ synced: true }));

    const onSynced = vi.fn();
    render(
      <GoogleAdsAccountPicker
        merchantId="550e8400-e29b-41d4-a716-446655440000"
        onSynced={onSynced}
        syncWindow={{ endDate: '2026-08-21', startDate: '2026-08-01' }}
      />
    );
    fireEvent.click(
      screen.getByRole('button', { name: /select google ads account/i })
    );
    await screen.findByRole('radio', { name: /••••7890/i });
    fireEvent.click(screen.getByRole('button', { name: /save account/i }));

    await waitFor(() => expect(onSynced).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/spend sync started/i)).toBeInTheDocument();
    expect(mockFetchWithCsrf).toHaveBeenNthCalledWith(
      1,
      '/api/integrations/ads/google/accounts',
      expect.objectContaining({
        body: JSON.stringify({ customerId: '1234567890' }),
        headers: {
          'x-baci-merchant-id': '550e8400-e29b-41d4-a716-446655440000',
        },
        method: 'PATCH',
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
          'x-baci-merchant-id': '550e8400-e29b-41d4-a716-446655440000',
        },
        method: 'POST',
      })
    );
  });

  it('refreshes analytics after account selection when the follow-up sync fails', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        accounts: [{ customerId: '1234567890', selected: false }],
      })
    );
    mockFetchWithCsrf
      .mockResolvedValueOnce(jsonResponse({ selected: true }))
      .mockResolvedValueOnce(
        jsonResponse({ error: 'Google Ads sync unavailable' }, 502)
      );
    const onSynced = vi.fn();

    render(<GoogleAdsAccountPicker onSynced={onSynced} />);
    fireEvent.click(
      screen.getByRole('button', { name: /select google ads account/i })
    );
    await screen.findByRole('radio', { name: /••••7890/i });
    fireEvent.click(screen.getByRole('button', { name: /save account/i }));

    expect(
      await screen.findByText('Google Ads sync unavailable')
    ).toBeInTheDocument();
    expect(onSynced).toHaveBeenCalledOnce();
  });

  it('does not refresh analytics when account selection itself fails', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        accounts: [{ customerId: '1234567890', selected: false }],
      })
    );
    mockFetchWithCsrf.mockResolvedValueOnce(
      jsonResponse({ error: 'Account selection changed' }, 409)
    );
    const onSynced = vi.fn();

    render(<GoogleAdsAccountPicker onSynced={onSynced} />);
    fireEvent.click(
      screen.getByRole('button', { name: /select google ads account/i })
    );
    await screen.findByRole('radio', { name: /••••7890/i });
    fireEvent.click(screen.getByRole('button', { name: /save account/i }));

    expect(
      await screen.findByText('Account selection changed')
    ).toBeInTheDocument();
    expect(onSynced).not.toHaveBeenCalled();
    expect(mockFetchWithCsrf).toHaveBeenCalledOnce();
  });

  it('shows a recoverable discovery error', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: 'Google Ads account discovery failed.' }, 502)
    );

    render(<GoogleAdsAccountPicker />);
    fireEvent.click(
      screen.getByRole('button', { name: /select google ads account/i })
    );

    expect(
      await screen.findByText('Google Ads account discovery failed.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(
      screen.getByRole('button', { name: /select google ads account/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Google Ads account discovery failed.')
    ).not.toBeInTheDocument();
  });

  it('provides retry and cancel controls when discovery succeeds with no accounts', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ accounts: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          accounts: [{ customerId: '1234567890', selected: false }],
        })
      );

    render(<GoogleAdsAccountPicker />);
    fireEvent.click(
      screen.getByRole('button', { name: /select google ads account/i })
    );

    expect(
      await screen.findByText(
        'No accessible Google Ads accounts were found for this login.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /retry account discovery/i })
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: /retry account discovery/i })
    );

    expect(
      await screen.findByRole('radio', { name: /••••7890/i })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(
      screen.getByRole('button', { name: /select google ads account/i })
    ).toBeInTheDocument();
  });

  it('syncs the local calendar day near a positive-offset midnight boundary', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 21, 0, 30));
    fetchMock.mockResolvedValue(
      jsonResponse({
        accounts: [{ customerId: '1234567890', selected: false }],
      })
    );
    mockFetchWithCsrf
      .mockResolvedValueOnce(jsonResponse({ selected: true }))
      .mockResolvedValueOnce(jsonResponse({ synced: true }));

    render(<GoogleAdsAccountPicker />);
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /select google ads account/i })
      );
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save account/i }));
      await Promise.resolve();
    });

    expect(mockFetchWithCsrf).toHaveBeenNthCalledWith(
      2,
      '/api/integrations/ads/google/sync',
      expect.objectContaining({
        body: expect.stringContaining(
          '"endDate":"2026-08-21","startDate":"2026-07-22","finalChunk":true'
        ),
      })
    );
  });

  it('chunks a long Google analytics window into 90-day sync requests', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        accounts: [{ customerId: '1234567890', selected: false }],
      })
    );
    mockFetchWithCsrf
      .mockResolvedValueOnce(jsonResponse({ selected: true }))
      .mockResolvedValueOnce(
        jsonResponse({
          syncRunId: '00000000-0000-4000-8000-000000000001',
          syncRunStartedAt: '2026-08-28T10:00:00.000Z',
          synced: true,
        })
      )
      .mockResolvedValueOnce(jsonResponse({ synced: true }));

    render(
      <GoogleAdsAccountPicker
        onSynced={vi.fn()}
        syncWindow={{ endDate: '2026-05-01', startDate: '2026-01-01' }}
      />
    );
    fireEvent.click(
      screen.getByRole('button', { name: /select google ads account/i })
    );
    await screen.findByRole('radio', { name: /••••7890/i });
    fireEvent.click(screen.getByRole('button', { name: /save account/i }));

    await waitFor(() => expect(mockFetchWithCsrf).toHaveBeenCalledTimes(3));
    expect(mockFetchWithCsrf).toHaveBeenNthCalledWith(
      2,
      '/api/integrations/ads/google/sync',
      expect.objectContaining({
        body: expect.stringContaining(
          '"endDate":"2026-03-31","startDate":"2026-01-01","finalChunk":false'
        ),
      })
    );
    expect(mockFetchWithCsrf).toHaveBeenNthCalledWith(
      3,
      '/api/integrations/ads/google/sync',
      expect.objectContaining({
        body: expect.stringContaining(
          '"endDate":"2026-05-01","startDate":"2026-04-01","finalChunk":true'
        ),
      })
    );
    const firstPayload = JSON.parse(
      (mockFetchWithCsrf.mock.calls[1]?.[1] as { body: string }).body
    ) as { syncRunId?: string; syncRunStartedAt?: string };
    const secondPayload = JSON.parse(
      (mockFetchWithCsrf.mock.calls[2]?.[1] as { body: string }).body
    ) as { syncRunId?: string; syncRunStartedAt?: string };
    expect(firstPayload.syncRunId).toBeUndefined();
    expect(firstPayload.syncRunStartedAt).toBeUndefined();
    expect(secondPayload.syncRunId).toBe(
      '00000000-0000-4000-8000-000000000001'
    );
    expect(secondPayload.syncRunStartedAt).toBe('2026-08-28T10:00:00.000Z');
  });
});

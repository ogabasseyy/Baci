import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SocialAdsAccountControls } from './social-ads-account-controls';

const fetchWithCsrf = vi.fn();
vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: (...args: unknown[]) => fetchWithCsrf(...args),
}));

const discoveryCases = [
  { displayName: 'Meta Ads', pathSegment: 'meta', provider: 'meta_ads' },
  {
    displayName: 'TikTok Ads',
    pathSegment: 'tiktok',
    provider: 'tiktok_ads',
  },
  {
    displayName: 'Snapchat Ads',
    pathSegment: 'snapchat',
    provider: 'snapchat_ads',
  },
] as const;

describe('SocialAdsAccountControls', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    fetchWithCsrf.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('selects an accessible account and starts a provider sync', async () => {
    const onSynced = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          accounts: [
            {
              accountId: 'act_123',
              currencyCode: 'NGN',
              label: 'Baci Meta',
              selected: false,
              timezoneName: 'Africa/Lagos',
            },
          ],
        })
      )
    );
    fetchWithCsrf.mockResolvedValue(new Response('{}'));

    render(
      <SocialAdsAccountControls
        displayName="Meta Ads"
        merchantId="550e8400-e29b-41d4-a716-446655440000"
        needsAccountSelection
        onSynced={onSynced}
        provider="meta_ads"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select account' }));
    expect(await screen.findByText('Baci Meta')).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/integrations/ads/meta/accounts',
      expect.objectContaining({
        credentials: 'include',
        headers: {
          'x-baci-merchant-id': '550e8400-e29b-41d4-a716-446655440000',
        },
      })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Save account and sync' })
    );

    await waitFor(() => expect(onSynced).toHaveBeenCalledOnce());
    expect(fetchWithCsrf).toHaveBeenNthCalledWith(
      1,
      '/api/integrations/ads/meta/accounts',
      expect.objectContaining({
        headers: {
          'x-baci-merchant-id': '550e8400-e29b-41d4-a716-446655440000',
        },
        method: 'PATCH',
      })
    );
    expect(fetchWithCsrf).toHaveBeenNthCalledWith(
      2,
      '/api/integrations/ads/meta/sync',
      expect.objectContaining({
        headers: {
          'x-baci-merchant-id': '550e8400-e29b-41d4-a716-446655440000',
        },
        method: 'POST',
      })
    );
  });

  it('refreshes analytics after account selection when the provider sync fails', async () => {
    const onSynced = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          accounts: [
            {
              accountId: 'act_123',
              label: 'Baci Meta',
              selected: false,
            },
          ],
        })
      )
    );
    fetchWithCsrf
      .mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Meta sync unavailable' }), {
          status: 502,
        })
      );

    render(
      <SocialAdsAccountControls
        displayName="Meta Ads"
        needsAccountSelection
        onSynced={onSynced}
        provider="meta_ads"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select account' }));
    await screen.findByText('Baci Meta');
    fireEvent.click(
      screen.getByRole('button', { name: 'Save account and sync' })
    );

    expect(
      await screen.findByText('Meta sync unavailable')
    ).toBeInTheDocument();
    expect(onSynced).toHaveBeenCalledOnce();
  });

  it('does not refresh analytics when social account selection fails', async () => {
    const onSynced = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          accounts: [{ accountId: 'act_123', label: 'Baci Meta' }],
        })
      )
    );
    fetchWithCsrf.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Account selection changed' }), {
        status: 409,
      })
    );

    render(
      <SocialAdsAccountControls
        displayName="Meta Ads"
        needsAccountSelection
        onSynced={onSynced}
        provider="meta_ads"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select account' }));
    await screen.findByText('Baci Meta');
    fireEvent.click(
      screen.getByRole('button', { name: 'Save account and sync' })
    );

    expect(
      await screen.findByText('Account selection changed')
    ).toBeInTheDocument();
    expect(onSynced).not.toHaveBeenCalled();
    expect(fetchWithCsrf).toHaveBeenCalledOnce();
  });

  it.each(
    discoveryCases
  )('retries $displayName account discovery with the same merchant scope', async ({
    displayName,
    pathSegment,
    provider,
  }) => {
    const merchantId = '550e8400-e29b-41d4-a716-446655440000';
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Temporary discovery failure' }), {
          status: 502,
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            accounts: [
              {
                accountId: `${pathSegment}_account_123`,
                label: `${displayName} account`,
                selected: false,
              },
            ],
          })
        )
      );

    render(
      <SocialAdsAccountControls
        displayName={displayName}
        merchantId={merchantId}
        needsAccountSelection
        provider={provider}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select account' }));

    expect(
      await screen.findByText('Temporary discovery failure')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Retry account discovery' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Retry account discovery' })
    );

    expect(
      await screen.findByText(`${displayName} account`)
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Temporary discovery failure')
    ).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/integrations/ads/${pathSegment}/accounts`,
      expect.objectContaining({
        credentials: 'include',
        headers: { 'x-baci-merchant-id': merchantId },
      })
    );
  });

  it('cancels a failed account discovery and resets the chooser', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Meta discovery unavailable' }), {
        status: 502,
      })
    );

    render(
      <SocialAdsAccountControls
        displayName="Meta Ads"
        needsAccountSelection
        provider="meta_ads"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select account' }));
    expect(
      await screen.findByText('Meta discovery unavailable')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(
      screen.getByRole('button', { name: 'Select account' })
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Meta discovery unavailable')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Retry account discovery' })
    ).not.toBeInTheDocument();
  });

  it('shows a safe sync error without exposing response internals', async () => {
    const onSynced = vi.fn();
    fetchWithCsrf.mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'TikTok reporting is unavailable' }),
        {
          status: 502,
        }
      )
    );

    render(
      <SocialAdsAccountControls
        displayName="TikTok Ads"
        merchantId="550e8400-e29b-41d4-a716-446655440000"
        needsAccountSelection={false}
        onSynced={onSynced}
        provider="tiktok_ads"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));

    expect(
      await screen.findByText('TikTok reporting is unavailable')
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Retry account discovery' })
    ).not.toBeInTheDocument();
    expect(onSynced).toHaveBeenCalledOnce();
  });

  it('syncs the local calendar day near a positive-offset midnight boundary', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 21, 0, 30));
    fetchWithCsrf.mockResolvedValue(new Response('{}'));

    render(
      <SocialAdsAccountControls
        displayName="Meta Ads"
        needsAccountSelection={false}
        provider="meta_ads"
      />
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
      await Promise.resolve();
    });

    expect(fetchWithCsrf).toHaveBeenCalledWith(
      '/api/integrations/ads/meta/sync',
      expect.objectContaining({
        body: expect.stringContaining(
          '"endDate":"2026-08-21","startDate":"2026-07-22","finalChunk":true'
        ),
      })
    );
  });

  it('uses the selected analytics window when syncing provider spend', async () => {
    fetchWithCsrf.mockResolvedValue(new Response('{}'));

    render(
      <SocialAdsAccountControls
        displayName="Meta Ads"
        needsAccountSelection={false}
        provider="meta_ads"
        syncWindow={{ endDate: '2026-08-21', startDate: '2026-08-01' }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));

    await waitFor(() => expect(fetchWithCsrf).toHaveBeenCalled());
    expect(fetchWithCsrf).toHaveBeenCalledWith(
      '/api/integrations/ads/meta/sync',
      expect.objectContaining({
        body: expect.stringContaining(
          '"endDate":"2026-08-21","startDate":"2026-08-01","finalChunk":true'
        ),
      })
    );
  });

  it('chunks a long Meta analytics window into provider-safe sync requests', async () => {
    fetchWithCsrf
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            syncRunId: '00000000-0000-4000-8000-000000000001',
            syncRunStartedAt: '2026-08-28T10:00:00.000Z',
            synced: true,
          })
        )
      )
      .mockResolvedValueOnce(new Response('{}'));

    render(
      <SocialAdsAccountControls
        displayName="Meta Ads"
        needsAccountSelection={false}
        provider="meta_ads"
        syncWindow={{ endDate: '2026-02-15', startDate: '2026-01-01' }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));

    await waitFor(() => expect(fetchWithCsrf).toHaveBeenCalledTimes(2));
    expect(fetchWithCsrf).toHaveBeenNthCalledWith(
      1,
      '/api/integrations/ads/meta/sync',
      expect.objectContaining({
        body: expect.stringContaining(
          '"endDate":"2026-01-31","startDate":"2026-01-01","finalChunk":false'
        ),
      })
    );
    expect(fetchWithCsrf).toHaveBeenNthCalledWith(
      2,
      '/api/integrations/ads/meta/sync',
      expect.objectContaining({
        body: expect.stringContaining(
          '"endDate":"2026-02-15","startDate":"2026-02-01","finalChunk":true'
        ),
      })
    );
    const firstPayload = JSON.parse(
      (fetchWithCsrf.mock.calls[0]?.[1] as { body: string }).body
    ) as { syncRunId?: string; syncRunStartedAt?: string };
    const secondPayload = JSON.parse(
      (fetchWithCsrf.mock.calls[1]?.[1] as { body: string }).body
    ) as { syncRunId?: string; syncRunStartedAt?: string };
    expect(firstPayload.syncRunId).toBeUndefined();
    expect(firstPayload.syncRunStartedAt).toBeUndefined();
    expect(secondPayload.syncRunId).toBe(
      '00000000-0000-4000-8000-000000000001'
    );
    expect(secondPayload.syncRunStartedAt).toBe('2026-08-28T10:00:00.000Z');
  });
});

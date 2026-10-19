import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SocialAdsConnectAction } from './social-ads-connect-action';

describe('SocialAdsConnectAction', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('surfaces a connect endpoint failure in the dashboard', async () => {
    const initialLocation = window.location.href;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'META_ADS_CONFIG_MISSING' }), {
        headers: { 'content-type': 'application/json' },
        status: 503,
      })
    );

    render(
      <SocialAdsConnectAction
        displayName="Meta Ads"
        href="/api/integrations/ads/meta/connect?merchantId=merchant-1"
        reconnect={false}
      />
    );

    fireEvent.click(screen.getByRole('link', { name: /connect meta ads/i }));

    await waitFor(() =>
      expect(screen.getByText('META_ADS_CONFIG_MISSING')).toBeInTheDocument()
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/integrations/ads/meta/connect?merchantId=merchant-1',
      {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      }
    );
    expect(
      screen.getByRole('link', { name: /connect meta ads/i })
    ).toBeInTheDocument();
    expect(window.location.href).toBe(initialLocation);
  });

  it('navigates to the provider authorization URL from a readable response', async () => {
    const navigateTo = vi.fn();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          authorizationUrl: 'https://www.facebook.com/dialog/oauth',
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }
      )
    );

    render(
      <SocialAdsConnectAction
        displayName="Meta Ads"
        href="/api/integrations/ads/meta/connect?merchantId=merchant-1"
        navigateTo={navigateTo}
        reconnect={false}
      />
    );

    fireEvent.click(screen.getByRole('link', { name: /connect meta ads/i }));

    await waitFor(() =>
      expect(navigateTo).toHaveBeenCalledWith(
        'https://www.facebook.com/dialog/oauth'
      )
    );
    expect(navigateTo).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/integrations/ads/meta/connect?merchantId=merchant-1',
      {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      }
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not navigate twice when the authorization payload is malformed', async () => {
    const navigateTo = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      })
    );

    render(
      <SocialAdsConnectAction
        displayName="Meta Ads"
        href="/api/integrations/ads/meta/connect?merchantId=merchant-1"
        navigateTo={navigateTo}
        reconnect={false}
      />
    );

    fireEvent.click(screen.getByRole('link', { name: /connect meta ads/i }));

    await waitFor(() =>
      expect(
        screen.getByText('Unable to connect Meta Ads.')
      ).toBeInTheDocument()
    );
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it('ignores repeated clicks while the authorization request is pending', async () => {
    let resolveResponse!: (response: Response) => void;
    const responsePromise = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockReturnValue(responsePromise);
    const navigateTo = vi.fn();

    render(
      <SocialAdsConnectAction
        displayName="Meta Ads"
        href="/api/integrations/ads/meta/connect?merchantId=merchant-1"
        navigateTo={navigateTo}
        reconnect={false}
      />
    );

    const link = screen.getByRole('link', { name: /connect meta ads/i });
    fireEvent.click(link);
    await waitFor(() => expect(link).toHaveAttribute('aria-disabled', 'true'));
    fireEvent.click(link);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveResponse(
      new Response(
        JSON.stringify({
          authorizationUrl: 'https://www.facebook.com/dialog/oauth',
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }
      )
    );

    await waitFor(() => expect(navigateTo).toHaveBeenCalledTimes(1));
  });
});

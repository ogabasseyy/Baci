import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchWithCsrf = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-client', () => ({ fetchWithCsrf }));

import { AdsDisconnectButton } from './ads-disconnect-button';

describe('AdsDisconnectButton', () => {
  beforeEach(() => fetchWithCsrf.mockReset());

  it.each([
    'google',
    'meta',
    'tiktok',
    'snapchat',
  ] as const)('disconnects %s with CSRF and the selected merchant context', async (provider) => {
    fetchWithCsrf.mockResolvedValue(new Response('{}'));
    const onDisconnected = vi.fn();

    render(
      <AdsDisconnectButton
        displayName="Ads account"
        merchantId="123e4567-e89b-42d3-a456-426614174000"
        onDisconnected={onDisconnected}
        provider={provider}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /disconnect ads/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Disconnect$/ }));

    await waitFor(() => expect(onDisconnected).toHaveBeenCalledOnce());
    expect(fetchWithCsrf).toHaveBeenCalledWith(
      `/api/integrations/ads/${provider}/disconnect`,
      {
        headers: {
          'x-baci-merchant-id': '123e4567-e89b-42d3-a456-426614174000',
        },
        method: 'DELETE',
      }
    );
  });

  it('disables the action while disconnecting and surfaces provider failure', async () => {
    let resolveRequest: (response: Response) => void = () => undefined;
    fetchWithCsrf.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveRequest = resolve;
      })
    );
    render(<AdsDisconnectButton displayName="Meta Ads" provider="meta" />);

    fireEvent.click(
      screen.getByRole('button', { name: /disconnect meta ads/i })
    );
    fireEvent.click(screen.getByRole('button', { name: /^Disconnect$/ }));
    expect(
      screen.getByRole('button', { name: /disconnecting meta ads/i })
    ).toBeDisabled();
    resolveRequest(
      new Response(JSON.stringify({ error: 'Disconnect was rejected.' }), {
        status: 500,
      })
    );

    expect(await screen.findByText('Disconnect was rejected.')).toBeVisible();
    expect(
      screen.getByRole('button', { name: /disconnect meta ads/i })
    ).toBeEnabled();
  });

  it('does not delete credentials when the confirmation is cancelled', () => {
    render(
      <AdsDisconnectButton displayName="Snapchat Ads" provider="snapchat" />
    );

    fireEvent.click(
      screen.getByRole('button', { name: /disconnect snapchat ads/i })
    );
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));

    expect(fetchWithCsrf).not.toHaveBeenCalled();
  });
});

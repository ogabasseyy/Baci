import { describe, expect, it, vi } from 'vitest';
import { getValidJumiaToken, refreshJumiaToken } from './token';

const baseIntegration = {
  id: 'integration-1',
  refresh_token: 'refresh-old',
  access_token: 'access-current',
  token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
};

describe('Jumia token helpers', () => {
  it('uses a buffered, unexpired access token without refreshing', async () => {
    const result = await getValidJumiaToken(
      {} as never,
      baseIntegration as never,
      {
        apiBase: 'https://vendor-api.example',
        clientId: 'client-id',
        refreshBufferMs: 5 * 60 * 1000,
      }
    );

    expect(result).toBe('access-current');
  });

  it('persists and returns the rotated token', async () => {
    const update = vi.fn(() => ({
      eq: vi.fn(() => Promise.resolve({ error: null })),
    }));
    const supabase = { from: vi.fn(() => ({ update })) };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'access-new',
          refresh_token: 'refresh-new',
          expires_in: 3600,
        }),
        { status: 200 }
      )
    );
    const integration = {
      ...baseIntegration,
      access_token: null,
      token_expires_at: null,
    } as never;

    const result = await refreshJumiaToken(supabase as never, integration, {
      apiBase: 'https://vendor-api.example',
      clientId: 'client-id',
      refreshBufferMs: 5 * 60 * 1000,
    });

    expect(result).toBe('access-new');
    expect(integration.access_token).toBe('access-new');
    expect(integration.refresh_token).toBe('refresh-new');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        access_token: 'access-new',
        refresh_token: 'refresh-new',
      })
    );
    fetchMock.mockRestore();
  });
});

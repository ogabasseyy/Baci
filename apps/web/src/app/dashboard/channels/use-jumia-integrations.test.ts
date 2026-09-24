import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: vi.fn((url: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers);
    if (options.body && typeof options.body === 'string') {
      headers.set('Content-Type', 'application/json');
    }
    headers.set('x-csrf-token', 'mock-csrf');

    return fetch(url, {
      ...options,
      headers: Object.fromEntries(headers.entries()),
      credentials: 'include',
    });
  }),
}));

import {
  checkProductApprovals,
  connectJumiaShops,
  disconnectIntegration,
  discoverJumiaShops,
  syncOrders,
  useJumiaIntegrations,
} from './use-jumia-integrations';

const DISCOVERY_ID = '00000000-0000-4000-8000-000000000099';

describe('useJumiaIntegrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('fetches integrations on mount and sets loading to false', async () => {
    const mockIntegrations = [
      {
        id: 'int-1',
        shop_id: 'shop-1',
        shop_name: 'Test Shop',
        country_code: 'NG',
        is_active: true,
        last_sync_at: null,
        sync_error: null,
      },
    ];

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ integrations: mockIntegrations }),
    } as Response);

    const { result } = renderHook(() => useJumiaIntegrations());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.integrations).toEqual(mockIntegrations);
    expect(result.current.error).toBeNull();
  });

  it('sets error when fetch response is not ok', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    } as Response);

    const { result } = renderHook(() => useJumiaIntegrations());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.integrations).toEqual([]);
    expect(result.current.error).toBe('Failed to load integrations (500)');
  });

  it('sets error when fetch throws a network error', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useJumiaIntegrations());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.integrations).toEqual([]);
    expect(result.current.error).toBe(
      'Failed to load integrations — please try again'
    );
  });

  it('defaults to empty array when response has no integrations key', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response);

    const { result } = renderHook(() => useJumiaIntegrations());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.integrations).toEqual([]);
  });

  it('refetch re-fetches data and clears previous error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: () => Promise.resolve({}),
    } as Response);

    const { result } = renderHook(() => useJumiaIntegrations());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Failed to load integrations (503)');

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ integrations: [] }),
    } as Response);

    await result.current.refetch();

    await waitFor(() => {
      expect(result.current.error).toBeNull();
    });
    expect(result.current.integrations).toEqual([]);
  });
});

describe('discoverJumiaShops', () => {
  it('preserves a retryable recovery handle from a failed discovery', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      json: () =>
        Promise.resolve({
          error: 'Jumia shop discovery failed',
          discoveryId: DISCOVERY_ID,
          retryable: true,
        }),
    } as Response);

    await expect(
      discoverJumiaShops('client-id', 'refresh-token')
    ).resolves.toEqual({
      ok: false,
      error: 'Jumia shop discovery failed',
      discoveryId: DISCOVERY_ID,
      retryable: true,
    });
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('returns discovered shops and opaque discovery id', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          discoveryId: DISCOVERY_ID,
          shops: [
            {
              id: 'shop-1',
              name: 'Shop One',
              countryCode: 'NG',
              marketplace: 'Jumia Nigeria',
              alreadyConnected: false,
            },
          ],
        }),
    } as Response);

    const result = await discoverJumiaShops('client-id', 'refresh-token');

    expect(result).toEqual({
      ok: true,
      discoveryId: DISCOVERY_ID,
      shops: [
        {
          id: 'shop-1',
          name: 'Shop One',
          countryCode: 'NG',
          marketplace: 'Jumia Nigeria',
          alreadyConnected: false,
        },
      ],
    });
  });

  it('returns the default failure message when discovery response is not ok and has no error field', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({}),
    } as Response);

    await expect(
      discoverJumiaShops('client-id', 'refresh-token')
    ).resolves.toEqual({ ok: false, error: 'Shop discovery failed' });
  });

  it('returns the network failure message when discovery fetch rejects', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

    await expect(
      discoverJumiaShops('client-id', 'refresh-token')
    ).resolves.toEqual({
      ok: false,
      error: 'Shop discovery failed — please try again',
    });
  });

  it('fails discovery when a successful response omits discoveryId', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          shops: [
            {
              id: 'shop-1',
              name: 'Shop One',
              countryCode: 'NG',
              marketplace: 'Jumia Nigeria',
              alreadyConnected: false,
            },
          ],
        }),
    } as Response);

    await expect(
      discoverJumiaShops('client-id', 'refresh-token')
    ).resolves.toEqual({ ok: false, error: 'Shop discovery failed' });
  });
});

describe('connectJumiaShops', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('returns ok true on successful connection', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      headers: new Headers(),
      json: () => Promise.resolve({ connected: [{ id: 'shop-1' }] }),
    } as Response);

    const result = await connectJumiaShops('client-id', DISCOVERY_ID, [
      'shop-1',
    ]);

    expect(result).toEqual({ ok: true, discoveryComplete: true });
    expect(fetch).toHaveBeenCalledWith(
      '/api/marketplace/jumia/connect',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          connectionType: 'self_authorization',
          clientId: 'client-id',
          discoveryId: DISCOVERY_ID,
          selectedShopIds: ['shop-1'],
        }),
      })
    );
  });

  it('preserves an incomplete discovery marker for partial connections', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      headers: new Headers([['x-jumia-discovery-complete', 'false']]),
      json: () => Promise.resolve({ connected: [{ id: 'shop-1' }] }),
    } as Response);

    await expect(
      connectJumiaShops('client-id', DISCOVERY_ID, ['shop-1'])
    ).resolves.toEqual({ ok: true, discoveryComplete: false });
  });

  it('returns error from response body on failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      headers: new Headers(),
      json: () => Promise.resolve({ error: 'Invalid token' }),
    } as Response);

    const result = await connectJumiaShops('client-id', DISCOVERY_ID, [
      'shop-1',
    ]);

    expect(result).toEqual({ ok: false, error: 'Invalid token' });
  });

  it('returns error on network failure', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

    const result = await connectJumiaShops('client-id', DISCOVERY_ID, [
      'shop-1',
    ]);

    expect(result).toEqual({
      ok: false,
      error: 'Connection failed — please try again',
    });
  });
});

describe('disconnectIntegration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('returns ok true on successful disconnect', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response);

    const result = await disconnectIntegration('id with spaces');

    expect(result).toEqual({ ok: true });
  });

  it('returns error when response is not ok', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
    } as Response);

    const result = await disconnectIntegration('int-1');

    expect(result).toEqual({ ok: false, error: 'Failed to disconnect' });
  });

  it('returns error on network failure', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

    const result = await disconnectIntegration('int-1');

    expect(result).toEqual({ ok: false, error: 'Failed to disconnect' });
  });
});

describe('syncOrders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('returns ok true with sync message on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ synced: 10, newOrders: 3 }),
    } as Response);

    const result = await syncOrders('int-1');

    expect(result).toEqual({
      ok: true,
      message: 'Synced 10 orders (3 new)',
    });
  });

  it('returns error with details when response includes details', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      json: () =>
        Promise.resolve({
          error: 'Token expired',
          details: 'Refresh token is no longer valid',
        }),
    } as Response);

    const result = await syncOrders('int-1');

    expect(result).toEqual({
      ok: false,
      error: 'Token expired\nDetails: Refresh token is no longer valid',
    });
  });
});

describe('checkProductApprovals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('reports approved products as ready for stock sync', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ updated: 2, pending: 0, failed: 0 }),
    } as Response);

    await expect(checkProductApprovals('int-1')).resolves.toEqual({
      ok: true,
      message: '2 products approved and ready for stock sync',
    });
  });

  it('reports mixed approval, pending, and rejected counts together', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ updated: 1, pending: 2, failed: 3 }),
    } as Response);

    await expect(checkProductApprovals('int-1')).resolves.toEqual({
      ok: true,
      message:
        '1 product approved and ready for stock sync; 2 products still pending Jumia approval; 3 products were rejected by Jumia',
    });
  });
});

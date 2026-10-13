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

import { syncStock } from './use-jumia-stock-sync';

describe('syncStock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('returns ok true with the route message on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          updated: 2,
          message: 'Pushed 2 stock updates to Jumia',
        }),
    } as Response);

    const result = await syncStock('int-1');

    expect(result).toEqual({
      ok: true,
      message: 'Pushed 2 stock updates to Jumia',
    });
  });

  it('fails when a 200 response reports success false', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: false,
          updated: 0,
          message:
            'Stock sync could not complete for some products; nothing was pushed',
        }),
    } as Response);

    const result = await syncStock('int-1');

    expect(result).toEqual({
      ok: false,
      error:
        'Stock sync could not complete for some products; nothing was pushed',
    });
  });
});

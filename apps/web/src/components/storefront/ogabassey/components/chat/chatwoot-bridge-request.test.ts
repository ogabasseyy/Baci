import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/csrf', () => ({
  buildCsrfHeaders: vi.fn((headers) => headers),
}));

import { postChatwootBridgeJson } from './chatwoot-bridge-request';

function response(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: async () => body };
}

describe('postChatwootBridgeJson', () => {
  it('adds the path-store merchant hint and same-origin request safeguards', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        response({ requestId: 'request-1' })
    );
    vi.stubGlobal('fetch', fetchMock);

    await postChatwootBridgeJson(
      '/api/storefront/chatwoot/context/challenge',
      { requestId: 'request-1' },
      'store-a'
    );

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/storefront/chatwoot/context/challenge?merchantSlug=store-a',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
      })
    );
  });

  it('preserves non-OK JSON only when a caller explicitly opts in', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(response({ accepted: false, code: 'refresh_required' }, false))
        .mockResolvedValueOnce(response({ accepted: false, code: 'refresh_required' }, false))
        .mockResolvedValueOnce({
          ok: false,
          status: 502,
          json: async () => {
            throw new SyntaxError('not JSON');
          },
        })
    );

    await expect(
      postChatwootBridgeJson('/cart', {}, 'store-a')
    ).resolves.toBeNull();
    await expect(
      postChatwootBridgeJson('/cart', {}, 'store-a', undefined, {
        allowNonOkResponse: true,
      })
    ).resolves.toEqual({
      accepted: false,
      code: 'refresh_required',
      httpStatus: 400,
    });
    await expect(
      postChatwootBridgeJson('/cart', {}, 'store-a', undefined, {
        allowNonOkResponse: true,
      })
    ).resolves.toEqual({ httpStatus: 502 });
  });

  it('returns null when the request transport fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));

    await expect(
      postChatwootBridgeJson('/cart', {}, 'store-a')
    ).resolves.toBeNull();
  });

  it('passes the cart-session fence signal to fetch', async () => {
    const fetchMock = vi.fn(async () => response({ accepted: true }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    await postChatwootBridgeJson('/cart', {}, 'store-a', controller.signal);

    expect(fetchMock).toHaveBeenCalledWith(
      '/cart?merchantSlug=store-a',
      expect.objectContaining({ signal: controller.signal })
    );
  });
});

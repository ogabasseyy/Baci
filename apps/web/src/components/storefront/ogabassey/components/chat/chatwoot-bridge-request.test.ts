import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/csrf', () => ({
  buildCsrfHeaders: vi.fn((headers) => headers),
}));

import { postChatwootBridgeJson } from './chatwoot-bridge-request';

function response(body: unknown, ok = true) {
  return { ok, json: async () => body };
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
});

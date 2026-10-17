import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiGet, fetchWithCsrf } from '@/lib/api-client';
import * as csrf from '@/lib/csrf';

describe('fetchWithCsrf', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('adds CSRF header for state-changing methods when token exists', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}'));
    vi.spyOn(csrf, 'getClientCsrfToken').mockReturnValue('csrf-token-value');

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      await fetchWithCsrf('/api/example', { method });

      const call = fetchSpy.mock.calls.at(-1);
      const init = call?.[1];
      const headers = new Headers(init?.headers);
      expect(headers.get(csrf.CSRF_HEADER_NAME)).toBe('csrf-token-value');
    }
  });

  it('initializes a CSRF token before state-changing requests when token is missing', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input) => {
        if (input === '/api/csrf') {
          return Promise.resolve(new Response('{}', { status: 200 }));
        }

        return Promise.resolve(new Response('{}'));
      });
    const tokenSpy = vi
      .spyOn(csrf, 'getClientCsrfToken')
      .mockReturnValueOnce(null)
      .mockReturnValueOnce('fresh-token');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // Intentionally suppress warning output during this assertion.
    });

    await fetchWithCsrf('/api/example', { method: 'POST' });

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      '/api/csrf',
      expect.objectContaining({
        cache: 'no-store',
        credentials: 'include',
      })
    );

    const init = fetchSpy.mock.calls[1]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get(csrf.CSRF_HEADER_NAME)).toBe('fresh-token');
    expect(tokenSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('uses the caller abort signal while initializing a missing CSRF token', async () => {
    const controller = new AbortController();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input) => {
        if (input === '/api/csrf') {
          return Promise.resolve(new Response('{}', { status: 200 }));
        }
        return Promise.resolve(new Response('{}'));
      });
    vi.spyOn(csrf, 'getClientCsrfToken')
      .mockReturnValueOnce(null)
      .mockReturnValueOnce('fresh-token');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await fetchWithCsrf('/api/upload', {
      method: 'POST',
      signal: controller.signal,
    });

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      '/api/csrf',
      expect.objectContaining({ signal: controller.signal })
    );
  });

  it('never adds CSRF header for GET requests', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}'));
    vi.spyOn(csrf, 'getClientCsrfToken').mockReturnValue('csrf-token-value');

    await fetchWithCsrf('/api/example', { method: 'GET' });

    const init = fetchSpy.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get(csrf.CSRF_HEADER_NAME)).toBeNull();
  });

  it('defaults to GET and does not add CSRF header when method is omitted', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}'));
    vi.spyOn(csrf, 'getClientCsrfToken').mockReturnValue('csrf-token-value');

    await fetchWithCsrf('/api/example');

    const init = fetchSpy.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get(csrf.CSRF_HEADER_NAME)).toBeNull();
  });

  it('does not set content-type when body is FormData', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}'));
    vi.spyOn(csrf, 'getClientCsrfToken').mockReturnValue('csrf-token-value');

    const formData = new FormData();
    formData.append('file', new Blob(['test']), 'test.jpg');

    await fetchWithCsrf('/api/upload', {
      method: 'POST',
      body: formData,
    });

    const init = fetchSpy.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get('content-type')).toBeNull();
  });

  it('sets content-type to application/json for stringified JSON body', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}'));
    vi.spyOn(csrf, 'getClientCsrfToken').mockReturnValue('csrf-token-value');

    await fetchWithCsrf('/api/example', {
      method: 'POST',
      body: JSON.stringify({ key: 'value' }),
    });

    const init = fetchSpy.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('retries once after an invalid CSRF response', async () => {
    const controller = new AbortController();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input, init) => {
        if (input === '/api/csrf') {
          return Promise.resolve(new Response('{}', { status: 200 }));
        }

        const headers = new Headers(init?.headers);
        const csrfHeader = headers.get(csrf.CSRF_HEADER_NAME);

        if (csrfHeader === 'stale-token') {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                error: 'Invalid CSRF token',
                message: 'CSRF token validation failed.',
              }),
              {
                status: 403,
                headers: { 'Content-Type': 'application/json' },
              }
            )
          );
        }

        return Promise.resolve(new Response('{}', { status: 200 }));
      });

    vi.spyOn(csrf, 'getClientCsrfToken')
      .mockReturnValueOnce('stale-token')
      .mockReturnValueOnce('fresh-token');

    const response = await fetchWithCsrf('/api/example', {
      method: 'PATCH',
      signal: controller.signal,
    });

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    const firstRequestHeaders = new Headers(
      fetchSpy.mock.calls[0]?.[1]?.headers
    );
    expect(firstRequestHeaders.get(csrf.CSRF_HEADER_NAME)).toBe('stale-token');

    const secondRequestHeaders = new Headers(
      fetchSpy.mock.calls[2]?.[1]?.headers
    );
    expect(secondRequestHeaders.get(csrf.CSRF_HEADER_NAME)).toBe('fresh-token');
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      '/api/csrf',
      expect.objectContaining({ signal: controller.signal })
    );
  });
});

describe('apiGet', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns parsed JSON for successful responses', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(apiGet('/api/test')).resolves.toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/test',
      expect.objectContaining({
        credentials: 'include',
        method: 'GET',
      })
    );
  });

  it('passes through fetch options while preserving credentials', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await apiGet('/api/storefront/products?merchant_id=m1', {
      cache: 'no-store',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/storefront/products?merchant_id=m1',
      expect.objectContaining({
        cache: 'no-store',
        credentials: 'include',
        method: 'GET',
      })
    );
  });

  it('preserves include credentials even if an unsafe caller bypasses the type', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await apiGet('/api/test', {
      credentials: 'omit',
    } as Omit<RequestInit, 'credentials' | 'method'>);

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/test',
      expect.objectContaining({
        credentials: 'include',
        method: 'GET',
      })
    );
  });

  it('rejects when the network request fails', async () => {
    const networkError = new Error('network down');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(networkError);

    await expect(apiGet('/api/test')).rejects.toThrow('network down');
  });

  it('throws API error messages for non-OK responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(apiGet('/api/missing')).rejects.toThrow('Not found');
  });

  it('throws API message fields for non-OK responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'Access denied' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(apiGet('/api/forbidden')).rejects.toThrow('Access denied');
  });

  it('falls back to a generic error when non-OK responses are not JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('plain failure', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      })
    );

    await expect(apiGet('/api/broken')).rejects.toThrow('Request failed');
  });

  it('throws when a successful response body is malformed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not json', {
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(apiGet('/api/test')).rejects.toThrow();
  });
});

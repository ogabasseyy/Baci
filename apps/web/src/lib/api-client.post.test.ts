import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiPost } from '@/lib/api-client';
import * as csrf from '@/lib/csrf';

describe('apiPost request options', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards caller headers while preserving the JSON POST contract', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    vi.spyOn(csrf, 'getClientCsrfToken').mockReturnValue('csrf-token');

    await expect(
      apiPost(
        '/api/shipping/quotes',
        { merchantId: 'merchant-1' },
        { headers: { 'x-baci-client': 'web-storefront' } }
      )
    ).resolves.toEqual({ ok: true });

    const init = fetchSpy.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get('x-baci-client')).toBe('web-storefront');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get(csrf.CSRF_HEADER_NAME)).toBe('csrf-token');
    expect(JSON.parse(String(init?.body))).toEqual({
      merchantId: 'merchant-1',
    });
  });

  it.each([
    false,
    0,
    '',
    null,
  ])('serializes a falsy payload (%s) instead of dropping it', async (payload) => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    vi.spyOn(csrf, 'getClientCsrfToken').mockReturnValue('csrf-token');

    await apiPost('/api/example', payload);

    expect(fetchSpy.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(payload));
  });
});

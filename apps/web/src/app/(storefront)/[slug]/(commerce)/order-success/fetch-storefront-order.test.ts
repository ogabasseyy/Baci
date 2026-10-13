import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchStorefrontOrderData } from './fetch-storefront-order';

const mockFetch = vi.fn();

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: () => Promise.resolve(body) } as Response;
}

describe('fetchStorefrontOrderData', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    mockFetch.mockReset();
  });

  it('queries the token-scoped storefront order endpoint', async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue(jsonResponse({ id: 'order-1' }));

    const data = await fetchStorefrontOrderData(
      'order-1',
      'test-store',
      'token-9'
    );

    expect(data).toEqual({ id: 'order-1' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/storefront/orders/order-1?merchant_slug=test-store&token=token-9'
    );
  });

  it('falls back to email lookup for guests without a token', async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue(jsonResponse({ id: 'order-2' }));

    await fetchStorefrontOrderData('order-2', 'test-store', null, 'a@b.co');

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/storefront/orders/order-2?merchant_slug=test-store&email=a%40b.co'
    );
  });

  it('omits the options argument without a signal', async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue(jsonResponse({ id: 'order-3' }));

    await fetchStorefrontOrderData('order-3', undefined, null);

    expect(mockFetch).toHaveBeenCalledWith('/api/storefront/orders/order-3');
    expect(mockFetch.mock.calls[0]).toHaveLength(1);
  });

  it('passes the abort signal through when provided', async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue(jsonResponse({ id: 'order-4' }));
    const controller = new AbortController();

    await fetchStorefrontOrderData(
      'order-4',
      'test-store',
      'token-9',
      null,
      controller.signal
    );

    expect(mockFetch).toHaveBeenCalledWith(expect.any(String), {
      signal: controller.signal,
    });
  });

  it('returns null on non-ok responses', async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue(jsonResponse(null, false));

    await expect(
      fetchStorefrontOrderData('order-5', 'test-store', 'token-9')
    ).resolves.toBeNull();
  });

  it('swallows abort errors silently (expected poll control flow)', async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockRejectedValue(new DOMException('aborted', 'AbortError'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      fetchStorefrontOrderData('order-6', 'test-store', 'token-9')
    ).resolves.toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('logs and returns null on unexpected failures', async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockRejectedValue(new Error('network down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      fetchStorefrontOrderData('order-7', 'test-store', 'token-9')
    ).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to fetch order',
      expect.any(Error)
    );
  });
});

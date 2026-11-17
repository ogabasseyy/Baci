import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchOrderTracking } from './fetch-order-tracking';

describe('fetchOrderTracking', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('looks up by token and merchant slug', async () => {
    fetchMock.mockResolvedValue(Response.json({ order: { id: 'o-1' } }));

    const result = await fetchOrderTracking('shop', { tracking_token: 'tok' });

    expect(result.error).toBeNull();
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]), 'https://x.test');
    expect(url.searchParams.get('token')).toBe('tok');
    expect(url.searchParams.get('merchant_slug')).toBe('shop');
    expect(url.searchParams.has('email')).toBe(false);
  });

  it('looks up by order id and email without a token', async () => {
    fetchMock.mockResolvedValue(Response.json({ order: { id: 'o-1' } }));

    await fetchOrderTracking('shop', { order_id: 'o-1', email: 'a@b.c' });

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]), 'https://x.test');
    expect(url.searchParams.get('order_id')).toBe('o-1');
    expect(url.searchParams.get('email')).toBe('a@b.c');
  });

  it('fails without a merchant slug or, for manual lookups, an email', async () => {
    expect(
      await fetchOrderTracking(undefined, { tracking_token: 't' })
    ).toEqual({
      data: null,
      error: 'Store identifier is missing.',
    });
    expect(await fetchOrderTracking('shop', { order_id: 'o-1' })).toEqual({
      data: null,
      error: 'Email is required to track an order.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the server error for a failed lookup', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: 'Order not found' }, { status: 404 })
    );

    expect(await fetchOrderTracking('shop', { tracking_token: 't' })).toEqual({
      data: null,
      error: 'Order not found',
    });
  });

  it('handles a non-JSON response', async () => {
    fetchMock.mockResolvedValue(new Response('<html>', { status: 502 }));

    const result = await fetchOrderTracking('shop', { tracking_token: 't' });

    expect(result.error).toBe(
      'Unexpected server response. Please try again later.'
    );
  });
});

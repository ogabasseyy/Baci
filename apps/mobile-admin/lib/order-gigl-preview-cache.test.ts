import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getQuote = vi.hoisted(() => vi.fn());
vi.mock('./order-gigl-shipping', () => ({ getOrderGiglQuote: getQuote }));

import {
  fetchOrderGiglPreview,
  getOrderGiglPreviewCacheScope,
  getOrderGiglPreviewQueryKey,
  getOrderGiglPreviewStaleTime,
  readFreshOrderGiglPreview,
} from './order-gigl-preview-cache';

const NOW = Date.parse('2026-09-01T17:00:00.000Z');
const request = {
  cacheScope: 'scope',
  orderId: 'order-1',
  receiver: {
    address: '1 Allen',
    city: 'Ikeja',
    phone: '0801',
    state: 'Lagos',
  },
};

function result(expiresAt: string) {
  return {
    availableBalance: 0,
    canBook: false,
    quote: {
      carrierName: 'GIG Logistics',
      currency: 'NGN' as const,
      displayName: 'Door Delivery',
      estimatedDays: 2,
      expiresAt,
      id: 'b2152ea0-831d-4387-b4c1-5dcf29a74c54',
      insuranceIncluded: false,
      pickupIncluded: true,
      price: 11000,
      provider: 'GIGL' as const,
      serviceTier: 'Express',
    },
    shortfall: 11000,
  };
}

describe('order GIG preview cache', () => {
  beforeEach(() => getQuote.mockReset());

  it('scopes previews to the viewer and items, ignoring item order', () => {
    const items = [
      { id: 'a', name: 'Phone', price: 100, quantity: 1 },
      { id: 'b', name: 'Case', price: 10, quantity: 2 },
    ];
    expect(getOrderGiglPreviewCacheScope({ items, userId: 'owner-1' })).toBe(
      getOrderGiglPreviewCacheScope({
        items: [...items].reverse(),
        userId: 'owner-1',
      })
    );
    expect(
      getOrderGiglPreviewCacheScope({ items, userId: 'owner-1' })
    ).not.toBe(
      getOrderGiglPreviewCacheScope({
        items: [{ ...items[0], quantity: 2 }, items[1]],
        userId: 'owner-1',
      })
    );
    expect(
      getOrderGiglPreviewCacheScope({ items, userId: 'owner-1' })
    ).not.toBe(getOrderGiglPreviewCacheScope({ items, userId: 'owner-2' }));
  });

  it('keys previews by order and receiver', () => {
    expect(getOrderGiglPreviewQueryKey(request)).not.toEqual(
      getOrderGiglPreviewQueryKey({
        ...request,
        receiver: { ...request.receiver, city: 'Yaba' },
      })
    );
  });

  it('stays fresh until 30 seconds before the quote expires', () => {
    expect(
      getOrderGiglPreviewStaleTime(result('2026-09-01T18:00:00.000Z'), NOW)
    ).toBe(60 * 60 * 1000 - 30_000);
    expect(
      getOrderGiglPreviewStaleTime(result('2026-09-01T17:00:10.000Z'), NOW)
    ).toBe(0);
    expect(getOrderGiglPreviewStaleTime(undefined, NOW)).toBe(0);
    expect(getOrderGiglPreviewStaleTime(result('not-a-date'), NOW)).toBe(0);
  });

  it('reads only a preview that is still fresh', () => {
    const client = new QueryClient();
    client.setQueryData(
      getOrderGiglPreviewQueryKey(request),
      result('2026-09-01T18:00:00.000Z')
    );
    expect(readFreshOrderGiglPreview(client, request, NOW)?.quote.price).toBe(
      11000
    );
    expect(
      readFreshOrderGiglPreview(
        client,
        request,
        Date.parse('2026-09-01T17:59:45Z')
      )
    ).toBeNull();
    expect(
      readFreshOrderGiglPreview(client, { ...request, orderId: 'order-2' }, NOW)
    ).toBeNull();
  });

  it('reuses a fresh preview and only requests GIG once', async () => {
    const client = new QueryClient();
    getQuote.mockResolvedValue(
      result(new Date(Date.now() + 60 * 60 * 1000).toISOString())
    );
    await fetchOrderGiglPreview(client, request);
    await fetchOrderGiglPreview(client, request);
    expect(getQuote).toHaveBeenCalledOnce();
    expect(getQuote).toHaveBeenCalledWith(
      'order-1',
      request.receiver,
      undefined,
      true
    );
  });

  it('requests again after a failed preview instead of caching the failure', async () => {
    const client = new QueryClient();
    getQuote
      .mockRejectedValueOnce(new Error('GIGL quote unavailable'))
      .mockResolvedValueOnce(
        result(new Date(Date.now() + 60 * 60 * 1000).toISOString())
      );
    await expect(fetchOrderGiglPreview(client, request)).rejects.toThrow(
      'GIGL quote unavailable'
    );
    await expect(fetchOrderGiglPreview(client, request)).resolves.toMatchObject(
      {
        quote: { price: 11000 },
      }
    );
    expect(getQuote).toHaveBeenCalledTimes(2);
  });
});

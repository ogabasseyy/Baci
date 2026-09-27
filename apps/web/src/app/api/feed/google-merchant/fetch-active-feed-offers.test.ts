import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { fetchActiveFeedOffers } from './fetch-active-feed-offers';

function mockClient(error: unknown = null) {
  const images = ['https://cdn.example/used.jpg'];
  const orderById = vi
    .fn()
    .mockResolvedValue({ data: [{ id: 'offer', images }], error });
  const orderByCondition = vi.fn().mockReturnValue({ order: orderById });
  const eq = vi.fn().mockReturnValue({ order: orderByCondition });
  const inFilter = vi.fn().mockReturnValue({ eq });
  const select = vi.fn().mockReturnValue({ in: inFilter });
  const client = {
    from: vi.fn().mockReturnValue({ select }),
  } as unknown as SupabaseClient;
  return {
    client,
    select,
    inFilter,
    eq,
    orderByCondition,
    orderById,
    images,
  };
}
describe('fetchActiveFeedOffers', () => {
  it('selects offer imagery and only active offers for requested products', async () => {
    const mock = mockClient();
    expect(await fetchActiveFeedOffers(mock.client, ['phone'])).toEqual([
      { id: 'offer', images: mock.images },
    ]);
    expect(mock.select).toHaveBeenCalledWith(
      'id, product_id, condition, price, compare_at_price, stock_quantity, images'
    );
    expect(mock.inFilter).toHaveBeenCalledWith('product_id', ['phone']);
    expect(mock.eq).toHaveBeenCalledWith('status', 'active');
  });
  it('batches product IDs and avoids queries for empty inputs', async () => {
    const mock = mockClient();
    await fetchActiveFeedOffers(mock.client, []);
    expect(mock.select).not.toHaveBeenCalled();
    await fetchActiveFeedOffers(
      mock.client,
      Array.from({ length: 251 }, (_, i) => String(i))
    );
    expect(mock.inFilter.mock.calls.map((call) => call[1].length)).toEqual([
      250, 1,
    ]);
  });
  it('orders offers by condition then id like the storefront', async () => {
    const mock = mockClient();
    await fetchActiveFeedOffers(mock.client, ['phone']);
    expect(mock.orderByCondition).toHaveBeenCalledWith('condition', {
      ascending: true,
    });
    expect(mock.orderById).toHaveBeenCalledWith('id', { ascending: true });
  });
  it('fails closed on database errors', async () => {
    await expect(
      fetchActiveFeedOffers(mockClient({ message: 'error' }).client, ['phone'])
    ).rejects.toThrow('Failed to fetch product offers');
  });
});

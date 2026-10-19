import { describe, expect, it, vi } from 'vitest';
import { fetchProductRouteDetails } from './fetch-product-route-details';

describe('fetchProductRouteDetails', () => {
  it('returns an empty product map when the product query fails', async () => {
    const result = await fetchProductRouteDetails(
      [{ id: 'item-1', product_id: 'product-1', quantity: 1, price: 1 }],
      vi.fn().mockResolvedValue({ data: null, error: { message: 'offline' } })
    );

    expect(result.size).toBe(0);
  });
});

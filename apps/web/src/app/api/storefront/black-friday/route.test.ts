import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const { getBlackFridayProducts } = vi.hoisted(() => ({
  getBlackFridayProducts: vi.fn(),
}));

vi.mock('@/lib/ogabassey-black-friday', () => ({ getBlackFridayProducts }));

beforeEach(() => vi.resetAllMocks());

describe('Black Friday storefront API', () => {
  it('returns the published lineup in order', async () => {
    const products = [{ slug: 'second' }, { slug: 'first' }];
    getBlackFridayProducts.mockResolvedValue(products);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ products });
  });

  it('returns an empty lineup before offers are available', async () => {
    getBlackFridayProducts.mockResolvedValue([]);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ products: [] });
  });

  it('distinguishes an upstream failure from an empty lineup', async () => {
    getBlackFridayProducts.mockRejectedValue(new Error('private details'));

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Black Friday products are temporarily unavailable.',
    });
  });
});

import { expect, it, vi } from 'vitest';
import { fetchCartCatalogConcurrently } from './fetch-cart-catalog-concurrently';

it('starts offer lookup from products before variants finish', async () => {
  let release = () => {};
  const variants = new Promise<string>((resolve) => {
    release = () => resolve('variants');
  });
  const loadOffers = vi.fn().mockResolvedValue('offers');
  const result = fetchCartCatalogConcurrently(
    Promise.resolve('products'),
    variants,
    loadOffers
  );
  try {
    await vi.waitFor(() => expect(loadOffers).toHaveBeenCalledWith('products'));
  } finally {
    release();
  }
  await expect(result).resolves.toEqual({
    productsResult: 'products',
    variantsResult: 'variants',
    offerMap: 'offers',
  });
});

it('propagates a failed offer lookup', async () => {
  await expect(
    fetchCartCatalogConcurrently(
      Promise.resolve('products'),
      Promise.resolve('variants'),
      async () => {
        throw new Error('lookup failed');
      }
    )
  ).rejects.toThrow('lookup failed');
});

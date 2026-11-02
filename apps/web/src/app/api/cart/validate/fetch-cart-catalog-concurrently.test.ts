import { expect, it, vi } from 'vitest';
import { fetchCartCatalogConcurrently } from './fetch-cart-catalog-concurrently';

it('starts offer lookup from products before variants finish', async () => {
  let release = () => {};
  const variants = new Promise<string>((resolve) => {
    release = () => resolve('variants');
  });
  let signalStarted = () => {};
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });
  const loadOffers = vi.fn(async () => {
    signalStarted();
    return 'offers';
  });
  const result = fetchCartCatalogConcurrently(
    Promise.resolve('products'),
    variants,
    loadOffers
  );
  try {
    await started;
    expect(loadOffers).toHaveBeenCalledWith('products');
  } finally {
    release();
  }
  await expect(result).resolves.toEqual({
    productsResult: 'products',
    variantsResult: 'variants',
    offerMap: 'offers',
  });
});

it.each([
  'products',
  'variants',
] as const)('propagates a rejected %s lookup', async (failed) => {
  const products =
    failed === 'products'
      ? Promise.reject(new Error('products failed'))
      : Promise.resolve('products');
  const variants =
    failed === 'variants'
      ? Promise.reject(new Error('variants failed'))
      : Promise.resolve('variants');
  await expect(
    fetchCartCatalogConcurrently(products, variants, async () => 'offers')
  ).rejects.toThrow(`${failed} failed`);
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

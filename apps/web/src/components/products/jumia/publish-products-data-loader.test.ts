import { describe, expect, it, vi } from 'vitest';
import {
  loadMappedProductMappings,
  loadPublishProducts,
} from './publish-products-data-loader';

describe('loadMappedProductMappings', () => {
  it('throws when the mapped-product lookup fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      })
    );

    await expect(
      loadMappedProductMappings('integration-1', new AbortController().signal)
    ).rejects.toThrow('Failed to load mapped Jumia products');
  });

  it('throws when the mapped-product payload is malformed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ids: ['product-1'] }),
      })
    );

    await expect(
      loadMappedProductMappings('integration-1', new AbortController().signal)
    ).rejects.toThrow('Failed to load mapped Jumia products');
  });

  it('returns mapping state grouped by product and seller SKU', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          mappings: [
            {
              productId: 'product-1',
              sellerSku: 'SKU-1',
              syncStatus: 'synced',
            },
            {
              productId: 'product-1',
              sellerSku: 'SKU-2',
              syncStatus: 'error',
            },
          ],
        }),
      })
    );

    await expect(
      loadMappedProductMappings('integration-1', new AbortController().signal)
    ).resolves.toEqual(
      new Map([
        [
          'product-1',
          [
            { sellerSku: 'SKU-1', syncStatus: 'synced' },
            { sellerSku: 'SKU-2', syncStatus: 'error' },
          ],
        ],
      ])
    );
  });

  it('preserves variant identity alongside the seller SKU', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          mappings: [
            {
              productId: 'product-1',
              variantId: 'variant-1',
              sellerSku: 'SKU-1',
              syncStatus: 'synced',
            },
          ],
        }),
      })
    );

    await expect(
      loadMappedProductMappings('integration-1', new AbortController().signal)
    ).resolves.toEqual(
      new Map([
        [
          'product-1',
          [
            {
              variantId: 'variant-1',
              sellerSku: 'SKU-1',
              syncStatus: 'synced',
            },
          ],
        ],
      ])
    );
  });

  it('rejects malformed variant identity values', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          mappings: [
            {
              productId: 'product-1',
              variantId: 7,
              sellerSku: 'SKU-1',
              syncStatus: 'synced',
            },
          ],
        }),
      })
    );

    await expect(
      loadMappedProductMappings('integration-1', new AbortController().signal)
    ).rejects.toThrow('Failed to load mapped Jumia products');
  });
});

describe('loadPublishProducts', () => {
  it('preserves variant ids from the products API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          products: [
            {
              id: 'product-1',
              name: 'Phone',
              price: 100,
              variants: [{ id: 'variant-1', sku: 'PHONE-BLACK' }],
            },
          ],
        }),
      })
    );

    const products = await loadPublishProducts(
      undefined,
      new AbortController().signal
    );

    expect(products[0]?.variants?.[0]?.id).toBe('variant-1');
  });

  it('stops at the maximum product page bound', async () => {
    const fetchMock = vi.fn((url: string) => {
      const page = Number(
        new URL(url, 'http://localhost').searchParams.get('page')
      );
      return Promise.resolve({
        ok: true,
        json: async () => ({
          products: [
            { id: `product-${page}`, name: `Product ${page}`, price: page },
          ],
          pagination: { page, limit: 100, totalPages: 75 },
        }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const products = await loadPublishProducts(
      undefined,
      new AbortController().signal
    );

    expect(products).toHaveLength(50);
    expect(products.at(-1)?.id).toBe('product-50');
    expect(fetchMock).toHaveBeenCalledTimes(50);
  });
});

import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { serveCatalogFixture } from './server-catalog-fixtures';

describe('catalog fixtures', () => {
  it('serves product and RPC fixtures while leaving other routes to the caller', async () => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (!serveCatalogFixture(request, response, url)) {
        response.statusCode = 404;
        response.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing port');
    const origin = `http://127.0.0.1:${address.port}`;
    try {
      const product = await fetch(`${origin}/rest/v1/products?id=eq.legacy-stock-product`);
      expect(await product.json()).toMatchObject({ stock_quantity: 0, stock: 3 });
      const variants = await fetch(`${origin}/rest/v1/rpc/get_storefront_product_variants`, {
        method: 'POST', body: JSON.stringify({ p_product_ids: ['variant-available-product'] }),
      });
      expect(await variants.json()).toEqual([expect.objectContaining({ product_id: 'variant-available-product', stock_quantity: 2 })]);
      const offers = await fetch(`${origin}/rest/v1/rpc/get_product_offers`, {
        method: 'POST', body: JSON.stringify({ p_product_id: 'condition-offer-product' }),
      });
      expect(await offers.json()).toEqual([expect.objectContaining({ condition: 'used', stock_quantity: 2 })]);
      expect((await fetch(`${origin}/unknown`)).status).toBe(404);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});

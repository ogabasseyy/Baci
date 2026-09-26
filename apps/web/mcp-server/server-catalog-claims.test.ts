import { describe, expect, it } from 'vitest';
import { mcpServerTestSupport } from './server-test-support';

const { getResultRecord, postMcpJsonRpc, startMcpServerWithPostgrest } = mcpServerTestSupport;

describe('MCP catalog claims', () => {
  it('proxies a transformed CDN product image to the widget', async () => {
    const server = await startMcpServerWithPostgrest({});
    try {
      const result = getResultRecord(await postMcpJsonRpc(server.baseUrl, {
        id: 101,
        method: 'tools/call',
        params: { name: 'search_products', arguments: { limit: 10 } },
      }));
      expect(result.structuredContent).toMatchObject({
        products: expect.arrayContaining([
          expect.objectContaining({
            id: 'transformed-image-product',
            image: 'https://mcp.ogabassey.com/images/core-assets/products/phone.avif?v=2',
          }),
        ]),
      });
    } finally {
      await server.close();
    }
  });

  it('normalizes a configured MCP origin with a trailing slash for image URLs', async () => {
    const server = await startMcpServerWithPostgrest({ MCP_PUBLIC_ORIGIN: 'https://mcp.example.test/' });
    try {
      const result = getResultRecord(await postMcpJsonRpc(server.baseUrl, {
        id: 111, method: 'tools/call',
        params: { name: 'search_products', arguments: { limit: 10 } },
      }));
      expect(result.structuredContent).toMatchObject({ products: expect.arrayContaining([
        expect.objectContaining({
          id: 'transformed-image-product',
          image: 'https://mcp.example.test/images/core-assets/products/phone.avif?v=2',
        }),
      ]) });
      expect(JSON.stringify(result)).not.toContain('mcp.example.test//images');
    } finally {
      await server.close();
    }
  });

  it('reports offer stock and a successful empty variant lookup consistently', async () => {
    const server = await startMcpServerWithPostgrest({});
    try {
      const search = getResultRecord(await postMcpJsonRpc(server.baseUrl, {
        id: 102,
        method: 'tools/call',
        params: { name: 'search_products', arguments: { limit: 10 } },
      }));
      expect(search.structuredContent).toMatchObject({
        products: expect.arrayContaining([
          expect.objectContaining({ id: 'condition-offer-product', in_stock: true }),
          expect.objectContaining({ id: 'variant-empty-product', in_stock: false }),
        ]),
      });
      const detail = getResultRecord(await postMcpJsonRpc(server.baseUrl, {
        id: 103,
        method: 'tools/call',
        params: { name: 'get_product', arguments: { product_id: 'condition-offer-product' } },
      }));
      expect(detail.structuredContent).toMatchObject({ products: [{ in_stock: true }] });
    } finally {
      await server.close();
    }
  });

  it('does not invent price trends or warranty terms from catalog prices', async () => {
    const server = await startMcpServerWithPostgrest({});
    try {
      const result = getResultRecord(
        await postMcpJsonRpc(server.baseUrl, {
          id: 12,
          method: 'tools/call',
          params: { name: 'search_products', arguments: { limit: 2 } },
        })
      );
      expect(result.structuredContent).toMatchObject({
        products: expect.arrayContaining([
          expect.objectContaining({ price_status: 'discounted' }),
          expect.objectContaining({ image: 'https://mcp.ogabassey.com/images/core-assets/products/redmi-15-midnight-black.avif' }),
        ]),
      });
      expect(JSON.stringify(result)).not.toMatch(/price_trend|Standard Warranty/);
      expect(JSON.stringify(result)).not.toContain('images.example.test');
    } finally {
      await server.close();
    }
  });

  it('does not label untracked variant quantities as out of stock', async () => {
    const server = await startMcpServerWithPostgrest({});
    try {
      const result = getResultRecord(
        await postMcpJsonRpc(server.baseUrl, {
          id: 11,
          method: 'tools/call',
          params: {
            name: 'get_product_variants',
            arguments: { product_id: 'available-product' },
          },
        })
      );
      expect(result.structuredContent).toMatchObject({
        variants: [{ availability: 'unconfirmed', stock_quantity: null }],
      });
      expect(JSON.stringify(result)).toContain('Confirm availability');
      expect(JSON.stringify(result)).not.toContain('Out of Stock');
    } finally {
      await server.close();
    }
  });

  it('uses tracked variant quantities when reporting product availability', async () => {
    const server = await startMcpServerWithPostgrest({});
    try {
      const result = getResultRecord(await postMcpJsonRpc(server.baseUrl, {
        id: 21,
        method: 'tools/call',
        params: { name: 'get_product', arguments: { product_id: 'variant-available-product' } },
      }));
      expect(result.structuredContent).toMatchObject({ products: [{ in_stock: true, stock_level: 'Last Units' }] });
      expect(JSON.stringify(result)).toContain('**Availability:** In Stock');
    } finally {
      await server.close();
    }
  });

  it('keeps untracked condition offers available for confirmation', async () => {
    const server = await startMcpServerWithPostgrest({});
    try {
      for (const name of ['get_product', 'get_product_variants']) {
        const result = getResultRecord(await postMcpJsonRpc(server.baseUrl, {
          id: 22,
          method: 'tools/call',
          params: { name, arguments: { product_id: 'untracked-offer-product' } },
        }));
        expect(result.structuredContent).toMatchObject({
          condition_offers: [{ availability: 'unconfirmed', stock_quantity: null }],
        });
        expect(JSON.stringify(result)).toContain('Confirm availability');
        expect(JSON.stringify(result)).not.toContain('Out of Stock');
      }
    } finally {
      await server.close();
    }
  });

  it('masks raw variant quantities for untracked products', async () => {
    const server = await startMcpServerWithPostgrest({});
    try {
      const result = getResultRecord(await postMcpJsonRpc(server.baseUrl, {
        id: 90,
        method: 'tools/call',
        params: { name: 'get_product', arguments: { product_id: 'untracked-variant-product' } },
      }));
      expect(result.structuredContent).toMatchObject({
        variants: [expect.objectContaining({ stock: null, availability: 'unconfirmed' })],
      });
    } finally {
      await server.close();
    }
  });

  it('preserves an object-shaped catalog image in recommendations', async () => {
    const server = await startMcpServerWithPostgrest({});
    try {
      const result = getResultRecord(await postMcpJsonRpc(server.baseUrl, {
        id: 23,
        method: 'tools/call',
        params: { name: 'get_recommendations', arguments: { use_case: 'phone' } },
      }));
      expect(result.structuredContent).toMatchObject({ products: expect.arrayContaining([
        expect.objectContaining({
          id: 'object-image-product',
          image: 'https://mcp.ogabassey.com/images/core-assets/products/redmi-15-midnight-black.avif',
        }),
      ]) });
    } finally {
      await server.close();
    }
  });

  it('recommends stocked options while excluding sold-out option products', async () => {
    const server = await startMcpServerWithPostgrest({});
    try {
      const variants = getResultRecord(await postMcpJsonRpc(server.baseUrl, {
        id: 112, method: 'tools/call',
        params: { name: 'get_recommendations', arguments: { use_case: 'variant' } },
      }));
      expect(variants.structuredContent).toMatchObject({ products: [
        expect.objectContaining({ id: 'variant-available-product' }),
      ] });
      expect(JSON.stringify(variants)).not.toContain('variant-sold-out-product');
      expect(JSON.stringify(variants)).not.toContain('variant-empty-product');

      const offers = getResultRecord(await postMcpJsonRpc(server.baseUrl, {
        id: 113, method: 'tools/call',
        params: { name: 'get_recommendations', arguments: { use_case: 'used offer' } },
      }));
      expect(offers.structuredContent).toMatchObject({ products: [
        expect.objectContaining({ id: 'condition-offer-product' }),
      ] });
    } finally {
      await server.close();
    }
  });

  it('treats an untracked product as available for browsing without claiming confirmed stock', async () => {
    const server = await startMcpServerWithPostgrest({});
    try {
      const result = getResultRecord(
        await postMcpJsonRpc(server.baseUrl, {
          id: 13,
          method: 'tools/call',
          params: { name: 'get_product', arguments: { product_id: 'available-product' } },
        })
      );
      expect(result.structuredContent).toMatchObject({
        products: [{ in_stock: null, stock_confidence: 'unconfirmed', stock_level: 'Confirm availability' }],
      });
      expect(JSON.stringify(result)).toContain('Confirm at checkout');
      expect(JSON.stringify(result)).toContain('https://ogabassey.com/products/test-phone');
      expect(JSON.stringify(result)).not.toContain('Out of Stock');
    } finally {
      await server.close();
    }
  });

});

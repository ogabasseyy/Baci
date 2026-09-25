import { describe, expect, it } from 'vitest';
import { mcpServerTestSupport } from './server-test-support';

const { getResultRecord, postMcpJsonRpc, startMcpServerWithPostgrest } = mcpServerTestSupport;

describe('MCP catalog claims', () => {
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

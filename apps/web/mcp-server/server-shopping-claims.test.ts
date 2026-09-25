import { describe, expect, it } from 'vitest';
import { mcpServerTestSupport } from './server-test-support';

const {
  getResultRecord,
  getResultTools,
  postMcpJsonRpc,
  startMcpServerWithPostgrest,
} = mcpServerTestSupport;

describe('MCP shopping claims', () => {
  it('opens the storefront from the widget origin instead of server JSON', async () => {
    const server = await startMcpServerWithPostgrest({});
    try {
      const response = await fetch(server.baseUrl, { redirect: 'manual' });
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('https://ogabassey.com');
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
        products: [
          { price_status: 'discounted' },
          { image: 'https://mcp.ogabassey.com/images/core-assets/products/redmi-15-midnight-black.avif' },
        ],
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

  it('points policy questions to the current public pages without hard-coded promises', async () => {
    const server = await startMcpServerWithPostgrest({});
    try {
      for (const [topic, path] of [
        ['shipping', 'shipping'],
        ['returns', 'returns'],
        ['contact', 'contact'],
      ]) {
        const result = getResultRecord(
          await postMcpJsonRpc(server.baseUrl, {
            id: 10,
            method: 'tools/call',
            params: { name: 'get_store_info', arguments: { topic } },
          })
        );
        expect(JSON.stringify(result)).toContain(`https://ogabassey.com/${path}`);
        expect(JSON.stringify(result)).not.toMatch(/international|pay on delivery|within 24 hours/i);
      }
    } finally {
      await server.close();
    }
  });

  it('limits widget images and cart redirects to Ogabassey origins', async () => {
    const server = await startMcpServerWithPostgrest({});
    try {
      const resource = getResultRecord(
        await postMcpJsonRpc(server.baseUrl, {
          id: 0,
          method: 'resources/read',
          params: { uri: 'ui://widget/store.html' },
        })
      );
      expect(resource.contents).toEqual([
        expect.objectContaining({
          _meta: expect.objectContaining({
            ui: expect.objectContaining({
              csp: {
                connectDomains: [],
                resourceDomains: ['https://mcp.ogabassey.com'],
              },
            }),
            'openai/widgetCSP': expect.objectContaining({
              redirect_domains: ['https://ogabassey.com'],
            }),
          }),
        }),
      ]);
    } finally {
      await server.close();
    }
  });

  it('withholds a numeric delivery quote when the public policy has no rate schedule', async () => {
    const server = await startMcpServerWithPostgrest({});
    try {
      const tools = getResultTools(
        await postMcpJsonRpc(server.baseUrl, {
          id: 1,
          method: 'tools/list',
          params: {},
        })
      );
      const shipping = tools.find((tool) => tool.name === 'get_shipping_quote');
      expect(shipping?.description).toContain('cannot provide a numeric quote');
      expect(shipping?.inputSchema.properties).not.toHaveProperty('address');
      expect(shipping?.inputSchema.properties).not.toHaveProperty('estimated_weight');

      const result = getResultRecord(
        await postMcpJsonRpc(server.baseUrl, {
          id: 2,
          method: 'tools/call',
          params: {
            name: 'get_shipping_quote',
            arguments: { state: 'Lagos' },
          },
        })
      );
      expect(result.structuredContent).toMatchObject({
        fee: null,
        policy_url: 'https://ogabassey.com/shipping',
        quote_available: false,
        status: 'requires_checkout',
      });
      expect(JSON.stringify(result)).not.toMatch(/GIGL|Topship|₦[0-9]|same day/i);
    } finally {
      await server.close();
    }
  });

  it('prepares a cart link only for an active product and does not claim the cart was saved', async () => {
    const server = await startMcpServerWithPostgrest({});
    try {
      const available = getResultRecord(
        await postMcpJsonRpc(server.baseUrl, {
          id: 3,
          method: 'tools/call',
          params: {
            name: 'add_to_cart',
            arguments: { product_id: 'available-product', quantity: 1 },
          },
        })
      );
      expect(available.structuredContent).toMatchObject({ success: true });
      expect(JSON.stringify(available)).toContain('Cart link ready');
      expect(JSON.stringify(available)).not.toContain('added to cart');

      const soldOut = getResultRecord(
        await postMcpJsonRpc(server.baseUrl, {
          id: 5,
          method: 'tools/call',
          params: {
            name: 'add_to_cart',
            arguments: { product_id: 'sold-out-product', quantity: 1 },
          },
        })
      );
      expect(soldOut.structuredContent).toMatchObject({ success: false });
      expect(JSON.stringify(soldOut)).not.toContain('cart_url');

      const soldOutVariant = getResultRecord(
        await postMcpJsonRpc(server.baseUrl, {
          id: 6,
          method: 'tools/call',
          params: {
            name: 'add_to_cart',
            arguments: { product_id: 'variant-sold-out-product', quantity: 1 },
          },
        })
      );
      expect(soldOutVariant.structuredContent).toMatchObject({ success: false });

      const availableVariant = getResultRecord(
        await postMcpJsonRpc(server.baseUrl, {
          id: 7,
          method: 'tools/call',
          params: {
            name: 'add_to_cart',
            arguments: { product_id: 'variant-available-product', quantity: 1 },
          },
        })
      );
      expect(availableVariant.structuredContent).toMatchObject({ success: true });

      const insufficientVariantQuantity = getResultRecord(
        await postMcpJsonRpc(server.baseUrl, {
          id: 8,
          method: 'tools/call',
          params: {
            name: 'add_to_cart',
            arguments: { product_id: 'variant-available-product', quantity: 3 },
          },
        })
      );
      expect(insufficientVariantQuantity.structuredContent).toMatchObject({ success: false });

      const unavailable = getResultRecord(
        await postMcpJsonRpc(server.baseUrl, {
          id: 4,
          method: 'tools/call',
          params: {
            name: 'add_to_cart',
            arguments: { product_id: 'missing-product', quantity: 1 },
          },
        })
      );
      expect(unavailable.structuredContent).toMatchObject({ success: false });
      expect(JSON.stringify(unavailable)).not.toContain('cart_url');
    } finally {
      await server.close();
    }
  });
});

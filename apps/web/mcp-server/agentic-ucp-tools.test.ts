import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { describe, expect, it, vi } from 'vitest';
import { registerAgenticUcpTools } from './agentic-ucp-tools';

describe('registerAgenticUcpTools', () => {
  it('advertises UCP catalog and cart tools to MCP clients', async () => {
    const { client, close } = await setupClient(vi.fn());

    try {
      const result = await client.listTools();
      expect(result.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          'cancel_ucp_cart',
          'convert_ucp_cart_to_checkout',
          'create_ucp_cart',
          'get_ucp_cart',
          'lookup_ucp_catalog_items',
          'search_ucp_catalog',
          'update_ucp_cart',
        ])
      );
    } finally {
      await close();
    }
  });

  it('returns structured success for UCP catalog search and cart creation', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ products: [{ id: 'product-1' }] }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'cart_1', status: 'active' }), {
          status: 201,
        })
      );
    const { client, close } = await setupClient(fetchImpl);

    try {
      const search = await client.callTool({
        arguments: { query: 'iphone' },
        name: 'search_ucp_catalog',
      });
      expect(textContent(search)).toContain('UCP catalog search completed');
      expect(search.structuredContent).toMatchObject({
        catalog: { products: [{ id: 'product-1' }] },
        status: 'success',
      });

      const cart = await client.callTool({
        arguments: { items: [{ id: 'product-1', quantity: 1 }] },
        name: 'create_ucp_cart',
      });
      expect(textContent(cart)).toContain('Created UCP cart cart_1');
      expect(cart.structuredContent).toMatchObject({
        cart: { id: 'cart_1', status: 'active' },
        status: 'success',
      });
    } finally {
      await close();
    }
  });

  it('returns structured errors for UCP cart tool failures', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Cart not found' }), { status: 404 })
    );
    const { client, close } = await setupClient(fetchImpl);

    try {
      const result = await client.callTool({
        arguments: { cart_id: 'missing-cart' },
        name: 'get_ucp_cart',
      });

      expect(textContent(result)).toContain(
        'Unable to read the UCP cart: Cart not found'
      );
      expect(result.structuredContent).toMatchObject({
        error: 'Cart not found',
        status: 'error',
        status_code: 404,
      });
    } finally {
      await close();
    }
  });
});

async function setupClient(fetchImpl: typeof fetch) {
  const server = new McpServer({ name: 'schema-test-server', version: '1.0.0' });
  const client = new Client({ name: 'schema-test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  registerAgenticUcpTools(server, {
    apiBaseUrl: 'https://ogabassey.com',
    apiKey: 'agentic-api-key',
    fetchImpl,
    signingKey: 'signing-secret',
  });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

function textContent(result: { content?: unknown }) {
  const content = Array.isArray(result.content) ? result.content : [];
  const first = content[0];
  if (!first || typeof first !== 'object' || !('text' in first)) return '';
  return typeof first.text === 'string' ? first.text : '';
}

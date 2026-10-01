// @vitest-environment node

import { describe, expect, it } from 'vitest';

const PUBLIC_TOOL_NAMES = [
  'add_to_cart',
  'browse_categories',
  'get_brands',
  'get_product',
  'get_product_variants',
  'get_shipping_quote',
  'get_store_info',
  'search_products',
];

describe('GET /.well-known/mcp/server-card.json', () => {
  it('publishes the Ogabassey public MCP server card', async () => {
    const { GET } = await import('./route');
    const response = GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(body).toMatchObject({
      $schema:
        'https://static.modelcontextprotocol.io/schemas/mcp-server-card/v1.json',
      version: '1.0',
      protocolVersion: '2025-06-18',
      serverInfo: {
        name: 'ogabassey-store',
        title: 'Ogabassey Store MCP Server',
        version: '1.0.0',
      },
      transport: {
        type: 'streamable-http',
        endpoint: 'https://mcp.ogabassey.com/mcp',
      },
      authentication: {
        required: false,
      },
    });
    expect(
      body.tools.map((tool: { name: string }) => tool.name).sort()
    ).toEqual(PUBLIC_TOOL_NAMES);
    expect(body.tools).not.toContainEqual(
      expect.objectContaining({ name: 'create_agentic_checkout_session' })
    );
    expect(body.tools).not.toContainEqual(
      expect.objectContaining({ name: 'check_order' })
    );
    expect(response.headers.get('cache-control')).toContain('max-age=3600');
  });

  it('matches the public MCP lookup and cart schemas', async () => {
    const { GET } = await import('./route');
    const body = await GET().json();
    const toolsByName = new Map(
      body.tools.map((tool: { name: string }) => [tool.name, tool])
    );

    expect(toolsByName.get('get_product')).toMatchObject({
      inputSchema: {
        anyOf: [{ required: ['product_id'] }, { required: ['product_name'] }],
        properties: {
          product_id: expect.objectContaining({ type: 'string' }),
          product_name: expect.objectContaining({ type: 'string' }),
        },
      },
    });
    expect(toolsByName.get('get_product_variants')).toMatchObject({
      inputSchema: toolsByName.get('get_product').inputSchema,
    });
    expect(toolsByName.get('add_to_cart')).toMatchObject({
      annotations: {
        destructiveHint: false,
        openWorldHint: false,
        readOnlyHint: true,
      },
      inputSchema: {
        required: ['product_id'],
        properties: {
          quantity: expect.objectContaining({ type: 'integer' }),
        },
      },
    });
    expect(
      toolsByName.get('add_to_cart').inputSchema.properties
    ).not.toHaveProperty('session_id');
  });
});

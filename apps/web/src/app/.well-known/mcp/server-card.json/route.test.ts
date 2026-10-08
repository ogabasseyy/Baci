// @vitest-environment node

import { describe, expect, it } from 'vitest';

const PUBLIC_TOOL_NAMES = [
  'add_to_cart',
  'browse_categories',
  'get_brands',
  'get_delivery_fee_info',
  'get_product',
  'get_product_variants',
  'get_store_info',
  'prepare_storefront_cart_link',
  'search_products',
  'update_ogabassey_guest_cart',
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
    expect(toolsByName.get('prepare_storefront_cart_link')).toMatchObject({
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
      toolsByName.get('prepare_storefront_cart_link').inputSchema.properties
    ).not.toHaveProperty('session_id');
    expect(toolsByName.get('update_ogabassey_guest_cart')).toMatchObject({
      annotations: {
        destructiveHint: true,
        openWorldHint: false,
        readOnlyHint: false,
      },
      inputSchema: {
        required: ['product_id'],
        properties: {
          quantity: expect.objectContaining({ type: 'integer' }),
        },
      },
    });
    expect(
      toolsByName.get('update_ogabassey_guest_cart').inputSchema.properties
    ).not.toHaveProperty('session_id');
  });

  it('publishes the search_products intent contract', async () => {
    const { GET } = await import('./route');
    const body = await GET().json();
    const searchProducts = body.tools.find(
      (tool: { name: string }) => tool.name === 'search_products'
    );

    expect(searchProducts.description).toContain('intent');
    expect(searchProducts.inputSchema.required).toEqual(
      expect.arrayContaining(['intent'])
    );
    expect(searchProducts.inputSchema.properties.intent).toMatchObject({
      type: 'object',
      required: ['alternatives'],
      properties: {
        alternatives: expect.objectContaining({
          minItems: 1,
          maxItems: 5,
        }),
      },
    });
    const attributeBranches =
      searchProducts.inputSchema.properties.intent.properties.alternatives.items
        .properties.attributes.items.oneOf;
    expect(attributeBranches).toHaveLength(2);
    expect(attributeBranches[0]).toMatchObject({
      properties: {
        key: { enum: expect.arrayContaining(['storage_gb', 'power_w']) },
        operator: { enum: ['eq', 'gte', 'lte'] },
        value: {
          anyOf: [
            { const: 0 },
            { type: 'number', minimum: 0.000001, maximum: 1000000000 },
          ],
        },
      },
    });
    expect(attributeBranches[1]).toMatchObject({
      properties: {
        key: { enum: expect.arrayContaining(['color']) },
        operator: { enum: ['eq'] },
        value: { type: 'string' },
      },
    });
  });

  it('publishes live delivery estimates with checkout confirmation and bounded inputs', async () => {
    const { GET } = await import('./route');
    const body = await GET().json();
    const tool = body.tools.find(
      (candidate: { name: string }) =>
        candidate.name === 'get_delivery_fee_info'
    );

    expect(tool).toMatchObject({
      title: 'Check Delivery Fee Information',
      description: expect.stringContaining(
        'Get live GIG Logistics delivery estimates'
      ),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
      inputSchema: {
        required: ['state'],
        properties: {
          state: expect.objectContaining({ type: 'string' }),
          city: expect.objectContaining({ type: 'string' }),
          items: expect.objectContaining({
            type: 'array',
            minItems: 1,
            maxItems: 5,
          }),
          delivery_preference: expect.objectContaining({
            enum: ['door', 'pickup_station'],
          }),
        },
      },
    });
    expect(tool.description).toContain('Weight is per unit');
    expect(tool.description).toContain('Never invent rates or weights');
    expect(tool.description).toContain('must be confirmed at checkout');
    expect(tool.description).toContain('does not modify a cart');
    expect(tool.inputSchema.properties).not.toHaveProperty('address');
    expect(tool.inputSchema.properties).not.toHaveProperty('estimated_weight');
  });
});

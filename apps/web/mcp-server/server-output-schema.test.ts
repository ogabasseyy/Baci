import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mcpServerTestSupport } from './server-test-support';
import { mcpToolOutputSchemas } from '../src/schemas/mcp-tool-output';

const { getResultTools, postMcpJsonRpc, startMcpServerWithPostgrest } = mcpServerTestSupport;
const { getResultRecord } = mcpServerTestSupport;

describe('public MCP output contracts', () => {
  it('allows a declared-schema delivery tool error without structured content in the real SDK client', async () => {
    const server = await startMcpServerWithPostgrest({});
    const client = new Client({ name: 'output-contract-test', version: '1.0.0' });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${server.baseUrl}/mcp`)));
      const { tools } = await client.listTools();
      expect(tools.find((tool) => tool.name === 'get_delivery_fee_info')?.outputSchema).toBeDefined();
      const result = await client.callTool({ name: 'get_delivery_fee_info', arguments: { state: '  ', city: 'Ikeja' } });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(result.content).toMatchObject([{ type: 'text', text: 'Please provide a valid Nigerian state and, if supplied, a valid city name.' }]);
    } finally {
      try {
        await client.close();
      } finally {
        await server.close();
      }
    }
  }, 30_000);

  it('distinguishes empty product causes for structured-only consumers', async () => {
    for (const merchantAvailable of [true, false]) {
      const server = await startMcpServerWithPostgrest({}, { merchantAvailable });
      const cases = merchantAvailable
        ? [
            { args: { product_name: '  ' }, status: 'invalid_input', message: 'Please provide a valid product ID or product name.' },
            { args: { product_id: 'missing-product' }, status: 'not_found', message: 'Product "missing-product" not found.' },
          ]
        : [{ args: { product_id: 'available-product' }, status: 'unavailable', message: 'Store temporarily unavailable.' }];
      try {
        for (const [index, { args, status, message }] of cases.entries()) {
          const result = getResultRecord(await postMcpJsonRpc(server.baseUrl, {
            id: index + 100, method: 'tools/call', params: { name: 'get_product', arguments: args },
          }));
          expect(result.isError).not.toBe(true);
          expect(result.structuredContent).toEqual({ products: [], status, message });
          expect(mcpToolOutputSchemas.get_product.safeParse(result.structuredContent).success).toBe(true);
        }
      } finally {
        await server.close();
      }
    }
  }, 30_000);

  it('reports catalog outages as unavailable for both product lookup tools', async () => {
    const server = await startMcpServerWithPostgrest({}, { productQueryFails: true });
    const client = new Client({ name: 'catalog-outage-test', version: '1.0.0' });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${server.baseUrl}/mcp`)));
      for (const name of ['get_product', 'get_product_variants'] as const) {
        const result = await client.callTool({ name, arguments: { product_id: 'available-product' } });
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toMatchObject({ status: 'unavailable', message: 'Product lookup is temporarily unavailable.' });
        expect(mcpToolOutputSchemas[name].safeParse(result.structuredContent).success).toBe(true);
        expect(JSON.stringify(result)).not.toContain('Fixture database unavailable');
        expect(JSON.stringify(result)).not.toContain('not found');
      }
    } finally {
      try { await client.close(); } finally { await server.close(); }
    }
  }, 30_000);

  it('publishes a meaningful output schema for every public tool', async () => {
    const server = await startMcpServerWithPostgrest({});
    try {
      const definitions = getResultTools(await postMcpJsonRpc(server.baseUrl, {
        id: 1, method: 'tools/list', params: {},
      }));
      expect(definitions).toHaveLength(8);
      for (const definition of definitions) {
        expect(definition, definition.name).toHaveProperty('outputSchema');
        const schema = Reflect.get(definition, 'outputSchema');
        expect(schema, definition.name).toMatchObject({ type: 'object' });
        expect(Object.keys(schema.properties), definition.name).not.toHaveLength(0);
        expect(schema.required.length, definition.name).toBeGreaterThan(0);
      }
    } finally {
      await server.close();
    }
  }, 30_000);

  it('validates real SDK success, empty, unavailable, and option-selection responses', async () => {
    const server = await startMcpServerWithPostgrest({});
    const cases: Array<[keyof typeof mcpToolOutputSchemas, Record<string, unknown>]> = [
      ['search_products', { intent: { alternatives: [{}] }, limit: 10 }],
      ['search_products', { intent: { alternatives: [{ model: 'does-not-exist' }] } }],
      ['add_to_cart', { product_id: 'available-product' }],
      ['add_to_cart', { product_id: 'variant-available-product' }],
      ['add_to_cart', { product_id: 'sold-out-product' }],
      ['get_product', { product_id: 'available-product' }],
      ['get_product', { product_id: 'condition-offer-product' }],
      ['get_product', { product_id: 'missing-product' }],
      ['get_product_variants', { product_id: 'variant-available-product' }],
      ['get_product_variants', { product_id: 'untracked-variant-product' }],
      ['get_product_variants', { product_id: 'condition-offer-product' }],
      ['get_product_variants', { product_id: 'available-product' }],
      ['get_product_variants', { product_id: 'missing-product' }],
      ['get_store_info', { topic: 'shipping' }],
      ['browse_categories', {}],
      ['get_brands', {}],
      ['get_delivery_fee_info', { state: 'Lagos', city: 'Ikeja' }],
    ];
    try {
      for (const [index, [name, args]] of cases.entries()) {
        const result = getResultRecord(await postMcpJsonRpc(server.baseUrl, {
          id: index + 10, method: 'tools/call', params: { name, arguments: args },
        }));
        expect(result.isError, JSON.stringify({ name, args, result })).not.toBe(true);
        expect(mcpToolOutputSchemas[name].safeParse(result.structuredContent).success,
          JSON.stringify({ name, args, result })).toBe(true);
      }
    } finally {
      await server.close();
    }
  }, 30_000);
});

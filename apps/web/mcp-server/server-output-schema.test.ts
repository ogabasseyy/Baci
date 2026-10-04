import { describe, expect, it } from 'vitest';
import { mcpServerTestSupport } from './server-test-support';
import { mcpToolOutputSchemas } from '../src/schemas/mcp-tool-output';

const { getResultTools, postMcpJsonRpc, startMcpServerWithPostgrest } = mcpServerTestSupport;
const { getResultRecord } = mcpServerTestSupport;

describe('public MCP output contracts', () => {
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

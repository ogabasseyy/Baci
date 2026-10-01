import { expect, it } from 'vitest';
import { mcpServerTestSupport } from './server-test-support';

const { getResultTools, getResultRecord, postMcpJsonRpc, startMcpServerWithPostgrest } = mcpServerTestSupport;

it('advertises structured intent and returns the matching offer evidence through the real MCP tool', async () => {
  const server = await startMcpServerWithPostgrest({});
  try {
    const tools = getResultTools(await postMcpJsonRpc(server.baseUrl, { id: 901, method: 'tools/list', params: {} }));
    const schema = tools.find((tool) => tool.name === 'search_products')?.inputSchema;
    expect(schema?.properties.intent).toBeDefined();
    expect(schema?.required ?? []).not.toContain('intent');
    const missing = getResultRecord(await postMcpJsonRpc(server.baseUrl, {
      id: 900, method: 'tools/call', params: { name: 'search_products', arguments: { query: 'phone' } },
    }));
    expect(missing.isError).toBe(true);
    expect(missing.structuredContent).toMatchObject({ status: 'error', message: expect.stringMatching(/intent is required/i) });
    const result = getResultRecord(await postMcpJsonRpc(server.baseUrl, {
      id: 902, method: 'tools/call', params: { name: 'search_products', arguments: {
        intent: { alternatives: [{}] }, max_price: 100000, sort: 'price_asc', limit: 2,
      } },
    }));
    expect(result.structuredContent).toMatchObject({
      status: 'success', search_mode: 'structured', coverage: 'complete',
      products: [
        { id: 'condition-offer-product', price: 80000, condition: 'used', matched_option: { kind: 'offer', price: 80000, condition: 'used' } },
        { id: 'variant-cheaper-than-parent', price: 90000, matched_option: { kind: 'variant', price: 90000 } },
      ],
    });
    const rejected = getResultRecord(await postMcpJsonRpc(server.baseUrl, {
      id: 903, method: 'tools/call', params: { name: 'search_products', arguments: {
        intent: { alternatives: [{ attributes: [{ key: 'storage_gb', operator: 'gte', value: '256' }] }] },
      } },
    }));
    expect(rejected.isError).toBe(true);
  } finally {
    await server.close();
  }
});

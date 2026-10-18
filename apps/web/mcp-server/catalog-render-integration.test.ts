import { expect, it } from 'vitest';
import { mcpServerTestSupport } from './server-test-support';
const {
  startMcpServerWithPostgrest,
  postMcpJsonRpc,
  getResultRecord,
  getResultTools,
} = mcpServerTestSupport;
it('only the catalog renderer launches UI and reuses public product lookup', async () => {
  const server = await startMcpServerWithPostgrest({});
  try {
    const tools = getResultTools(
      await postMcpJsonRpc(server.baseUrl, {
        id: 1,
        method: 'tools/list',
        params: {},
      }),
    );
    for (const name of ['search_products', 'get_product']) {
      expect(tools.find((t) => t.name === name)?._meta).not.toHaveProperty(
        'openai/outputTemplate',
      );
    }
    expect(
      tools.find((t) => t.name === 'render_ogabassey_catalog')?._meta,
    ).toMatchObject({ ui: { resourceUri: 'ui://widget/store-v5.html' } });
    const result = getResultRecord(
      await postMcpJsonRpc(server.baseUrl, {
        id: 2,
        method: 'tools/call',
        params: {
          name: 'render_ogabassey_catalog',
          arguments: { products: [{ product_id: 'available-product' }] },
        },
      }),
    );
    expect(result.structuredContent).toMatchObject({
      products: [{ id: 'available-product', name: 'Test Phone' }],
    });
    const details = getResultRecord(
      await postMcpJsonRpc(server.baseUrl, {
        id: 3,
        method: 'tools/call',
        params: {
          name: 'get_product',
          arguments: { product_id: 'available-product' },
        },
      }),
    );
    expect(details).not.toHaveProperty('_meta.openai/outputTemplate');
  } finally {
    await server.close();
  }
});

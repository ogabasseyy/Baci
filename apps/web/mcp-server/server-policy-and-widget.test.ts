import { describe, expect, it } from 'vitest';
import { mcpServerTestSupport } from './server-test-support';

const { getResultRecord, getResultTools, postMcpJsonRpc, startMcpServerWithPostgrest } = mcpServerTestSupport;

describe('MCP policy and widget responses', () => {
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

  it('serves the same validated premium widget through the render endpoint', async () => {
    const server = await startMcpServerWithPostgrest({});
    try {
      const resource = getResultRecord(await postMcpJsonRpc(server.baseUrl, {
        id: 91,
        method: 'resources/read',
        params: { uri: 'ui://widget/store.html' },
      }));
      const contents = resource.contents as Array<{ text: string }>;
      const render = await fetch(`${server.baseUrl}/mcp/render/store`);
      expect(render.status).toBe(200);
      expect(await render.text()).toBe(contents[0].text);
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

});

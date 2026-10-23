import type { McpServer } from '@modelcontextprotocol/server';
import { expect, it, vi } from 'vitest';
import { registerCatalogRenderer } from './catalog-render-tool';

it.each([true, false])('marks catalog responses with the actual connection mode: %s', async (connected) => {
  const registerTool = vi.fn();
  registerCatalogRenderer({ registerTool } as unknown as McpServer, 'ui://widget/store-v5.html',
    async () => ({ structuredContent: { products: [] } }), undefined, connected);
  const render = registerTool.mock.calls[0][2];
  const reply = await render({ products: [{ product_id: '11111111-1111-4111-8111-111111111111' }] });
  expect(reply._meta).toEqual({ connection_bound: connected });
});

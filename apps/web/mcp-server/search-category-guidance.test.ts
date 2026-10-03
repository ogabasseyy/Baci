import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PUBLIC_MCP_TOOLS } from '../src/config/mcp-server-card-tools';
import { createSearchProductsToolConfig } from './search-products-tool-config';
import { MCP_SEARCH_CATEGORY_GUIDANCE } from './search-category-guidance';

describe('published category guidance parity', () => {
  it('advertises the explicit-only runtime category rule in the server card', () => {
    const search = PUBLIC_MCP_TOOLS.find((tool) => tool.name === 'search_products');
    expect(search).toMatchObject({
      description: expect.stringContaining(MCP_SEARCH_CATEGORY_GUIDANCE),
      inputSchema: { properties: { category: { description: MCP_SEARCH_CATEGORY_GUIDANCE } } },
    });
  });
  it('uses the same guidance for the runtime category schema', () => {
    const serverSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'server.ts'), 'utf8');
    expect(serverSource).toContain('createSearchProductsToolConfig(STORE_WIDGET_URI)');
    const runtime = createSearchProductsToolConfig('ui://widget/test.html');
    const published = PUBLIC_MCP_TOOLS.find((tool) => tool.name === 'search_products');
    expect(runtime.description).toBe(published?.description);
    expect(runtime.inputSchema.category.description).toBe(MCP_SEARCH_CATEGORY_GUIDANCE);
    expect(runtime._meta['openai/outputTemplate']).toBe('ui://widget/test.html');
    // Published intent is required; optional transport permits the friendly invalid-intent response.
    expect(published?.inputSchema.required).toContain('intent');
    expect(runtime.inputSchema.intent.safeParse(undefined).success).toBe(true);
    expect(runtime.inputSchema.limit.parse(undefined)).toBe(10);
    expect(runtime.inputSchema.limit.safeParse(21).success).toBe(false);
  });
});

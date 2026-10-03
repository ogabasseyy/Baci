import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PUBLIC_MCP_TOOLS } from '../src/config/mcp-server-card-tools';
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
    const serverSource = readFileSync(resolve('mcp-server/server.ts'), 'utf8');
    expect(serverSource).toContain('.describe(MCP_SEARCH_CATEGORY_GUIDANCE)');
  });
});

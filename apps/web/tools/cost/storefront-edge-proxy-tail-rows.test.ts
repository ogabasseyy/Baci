import { describe, expect, it } from 'vitest';
import { STOREFRONT_EDGE_PROXY_TAIL_ROWS } from './storefront-edge-proxy-tail-rows';

describe('STOREFRONT_EDGE_PROXY_TAIL_ROWS', () => {
  it('keeps the blog sitemap rewrite and MCP rewrites in the frozen inventory', () => {
    const byId = new Map(
      STOREFRONT_EDGE_PROXY_TAIL_ROWS.map((row) => [row.id, row])
    );

    expect(byId.get('proxy:platform-root-blog-sitemap')).toEqual(
      expect.objectContaining({
        routePattern: '/blog/sitemap.xml',
        sourcePath: 'apps/web/next.config.ts',
      })
    );
    expect(byId.get('proxy:mcp-sse-rewrite')).toEqual(
      expect.objectContaining({
        routePattern: '/mcp/sse',
        sourcePath: 'apps/web/next.config.ts',
      })
    );
    expect(byId.get('proxy:mcp-messages-rewrite')).toEqual(
      expect.objectContaining({
        routePattern: '/mcp/messages',
        sourcePath: 'apps/web/next.config.ts',
      })
    );
  });
});

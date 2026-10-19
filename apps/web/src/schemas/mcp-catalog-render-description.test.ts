import { describe, expect, it } from 'vitest';
import { MCP_CATALOG_RENDER_DESCRIPTION } from './mcp-catalog-render-description';

describe('catalog render tool description', () => {
  it('explains the exact selected-option contract and read-only behavior', () => {
    expect(MCP_CATALOG_RENDER_DESCRIPTION).toContain('exact matched_option');
    expect(MCP_CATALOG_RENDER_DESCRIPTION).toContain('does not save a cart');
    expect(MCP_CATALOG_RENDER_DESCRIPTION).toContain(
      'Pass each product_id once'
    );
  });
});

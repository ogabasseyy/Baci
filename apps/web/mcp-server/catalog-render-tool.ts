import type { McpServer } from '@modelcontextprotocol/server';
import {
  MCP_CATALOG_RENDER_DESCRIPTION,
  mcpCatalogRenderInputSchema,
} from '../src/schemas/mcp-catalog-render';
import { mcpToolOutputSchemas } from '../src/schemas/mcp-tool-output';
import { createCatalogRenderer } from './create-catalog-renderer';

/** Register the app-only renderer for selected, server-validated products. */
export function registerCatalogRenderer(
  server: McpServer,
  uri: string,
  lookup: (id: string) => Promise<{ structuredContent?: unknown }>
) {
  server.registerTool(
    'render_ogabassey_catalog',
    {
      title: 'Show Ogabassey Product Catalog',
      description: MCP_CATALOG_RENDER_DESCRIPTION,
      inputSchema: mcpCatalogRenderInputSchema,
      outputSchema: mcpToolOutputSchemas.get_product,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: {
        ui: { resourceUri: uri, visibility: ['model', 'app'] },
        'openai/outputTemplate': uri,
        'openai/toolInvocation/invoking': 'Loading selected products…',
        'openai/toolInvocation/invoked': 'Catalog ready',
      },
    },
    createCatalogRenderer(lookup)
  );
}

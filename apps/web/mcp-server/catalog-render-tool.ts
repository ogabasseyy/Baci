import type { McpServer } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import {
  MCP_CATALOG_RENDER_DESCRIPTION,
  mcpCatalogRenderInputSchema as catalogRenderInputSchema,
} from '../src/schemas/mcp-catalog-render';
export { mcpCatalogRenderInputSchema as catalogRenderInputSchema } from '../src/schemas/mcp-catalog-render';
import { mcpToolOutputSchemas } from '../src/schemas/mcp-tool-output';

type ProductResult = { structuredContent?: unknown };
type Lookup = (id: string) => Promise<ProductResult>;

export function createCatalogRenderer(lookup: Lookup) {
  return async ({ product_ids }: z.infer<typeof catalogRenderInputSchema>) => {
    try {
      const { product_ids: ids } = catalogRenderInputSchema.parse({
        product_ids,
      });
      const products = await Promise.all(
        [...new Set(ids)].map(async (id) => {
          const result = await lookup(id);
          const parsed = mcpToolOutputSchemas.get_product.parse(
            result.structuredContent,
          );
          if (
            parsed.variant_lookup_failed ||
            parsed.offer_lookup_failed ||
            parsed.products.length !== 1 ||
            parsed.products[0].id !== id ||
            parsed.products[0].price === null
          )
            throw new Error('Product unavailable');
          return parsed.products[0];
        }),
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Showing selected Ogabassey products. Confirm options and availability before checkout.',
          },
        ],
        structuredContent: { products },
      };
    } catch {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: 'Selected products could not be loaded. Search again before rendering.',
          },
        ],
        structuredContent: {
          products: [],
          status: 'unavailable' as const,
          message:
            'Selected products could not be loaded. Search again before rendering.',
        },
      };
    }
  };
}

export function registerCatalogRenderer(
  server: McpServer,
  uri: string,
  lookup: Lookup,
) {
  server.registerTool(
    'render_ogabassey_catalog',
    {
      title: 'Show Ogabassey Product Catalog',
      description: MCP_CATALOG_RENDER_DESCRIPTION,
      inputSchema: catalogRenderInputSchema,
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
    createCatalogRenderer(lookup),
  );
}

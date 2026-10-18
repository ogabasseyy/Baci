import type { z } from 'zod';
import { mcpCatalogRenderInputSchema } from '../src/schemas/mcp-catalog-render';
import { mcpToolOutputSchemas } from '../src/schemas/mcp-tool-output';

/** Build the renderer that reloads selected products from authoritative data. */
export function createCatalogRenderer(
  lookup: (id: string) => Promise<{ structuredContent?: unknown }>
) {
  return async ({
    product_ids,
  }: z.infer<typeof mcpCatalogRenderInputSchema>) => {
    try {
      const { product_ids: ids } = mcpCatalogRenderInputSchema.parse({
        product_ids,
      });
      const products = await Promise.all(
        [...new Set(ids)].map(async (id) => {
          const result = await lookup(id);
          const parsed = mcpToolOutputSchemas.get_product.parse(
            result.structuredContent
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
        })
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

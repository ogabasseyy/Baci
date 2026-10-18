import { z } from 'zod';
import { mcpCatalogOptionReferenceSchema } from './mcp-matched-option';

export const MCP_CATALOG_RENDER_DESCRIPTION =
  'Display an interactive Ogabassey catalog for products already selected using search_products or get_product. Pass each exact product_id in the desired order. When selecting a specific matched_option from search_products, also pass its kind, option_id, variantId, and condition so the renderer can verify and preserve that choice. Use only when a visual catalog helps the shopper; search and compare data before rendering. This does not save a cart or start checkout. Products and options are fetched again so prices and availability are not supplied by the caller.';
export const mcpCatalogRenderInputSchema = z.strictObject({
  products: z
    .array(
      z.strictObject({
        product_id: z.string().min(1).max(80),
        matched_option: mcpCatalogOptionReferenceSchema.optional(),
      })
    )
    .min(1)
    .max(20),
});

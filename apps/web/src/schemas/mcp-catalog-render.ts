import { z } from 'zod';

export const MCP_CATALOG_RENDER_DESCRIPTION =
  'Display an interactive Ogabassey catalog for products already selected using search_products or get_product. Pass their exact product IDs in the desired order. Use only when a visual catalog helps the shopper; search and compare data before rendering. This does not save a cart or start checkout. Products are fetched again so prices and availability are not supplied by the caller.';
export const mcpCatalogRenderInputSchema = z.strictObject({
  product_ids: z.array(z.string().min(1).max(80)).min(1).max(20),
});

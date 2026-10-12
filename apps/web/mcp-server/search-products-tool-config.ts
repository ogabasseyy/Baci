import { mcpToolOutputSchemas } from '../src/schemas/mcp-tool-output';
import { z } from 'zod';
import { mcpDiscoveryIntentSchema } from '../src/schemas/mcp-discovery-intent';
import { MCP_SEARCH_CATEGORY_GUIDANCE } from './search-category-guidance';
import { MCP_SEARCH_PRODUCTS_DESCRIPTION } from './search-products-description';

/** Search registration metadata/schema; retrieval handler remains in the server. */
export function createSearchProductsToolConfig(widgetUri: string) {
  return {
    outputSchema: mcpToolOutputSchemas.search_products,
    title: 'Search Products',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: MCP_SEARCH_PRODUCTS_DESCRIPTION,
    inputSchema: {
      // Optional at the transport layer so a missing intent reaches the friendly
      // invalidIntentMessage branch instead of a generic schema validation error.
      intent: mcpDiscoveryIntentSchema.describe('Supply structured intent for shopper searches. alternatives are OR; each branch is AND. Use singular canonical product types phone/laptop/tablet/charger/cable/security_camera/fragrance_diffuser. Brand means manufacturer, compatible_with means supported device model. Attributes use canonical units (storage_gb/ram_gb in GB, power_w in watts) and eq/gte/lte. Use an empty alternative for broad discovery; never invent unspecified constraints. Unknown catalog facts cannot satisfy explicit constraints.').optional(),
      query: z
        .string()
        .max(100)
        .optional()
        .describe('Retrieval keywords only: product name, model, or use case. Put hard constraints in intent and price fields; do not encode a whole sentence grammar in query.'),
      condition: z
        .enum(['new', 'used', 'open_box', 'refurbished'])
        .optional()
        .describe('Product condition'),
      category: z
        .string()
        .max(50)
        .optional()
        .describe(MCP_SEARCH_CATEGORY_GUIDANCE),
      brand: z.string().max(50).optional().describe('Brand name'),
      min_price: z.number().min(0).optional(),
      max_price: z.number().min(0).optional(),
      sort: z
        .enum(['price_asc', 'price_desc', 'newest', 'relevance'])
        .optional()
        .default('relevance'),
      limit: z.number().min(1).max(20).optional().default(10),
    },
    _meta: {
      'openai/outputTemplate': widgetUri,
      'openai/toolInvocation/invoking': 'Searching catalog...',
      'openai/toolInvocation/invoked': 'Search complete',
    },
  };
}

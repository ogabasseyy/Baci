import { z } from 'zod';
import { MCP_OPTION_COLOR_EVIDENCE_GUIDANCE } from '../../mcp-server/option-color-evidence-guidance';
import { MCP_SEARCH_CATEGORY_GUIDANCE } from '../../mcp-server/search-category-guidance';
import { MCP_SEARCH_PRODUCTS_DESCRIPTION } from '../../mcp-server/search-products-description';
import {
  MCP_DELIVERY_FEE_INFO_DESCRIPTION,
  mcpDeliveryFeeInfoInputSchema,
} from '../schemas/mcp-delivery-fee-info';
import { SEARCH_PRODUCTS_INTENT_SCHEMA } from './mcp-server-card-intent-schema';

const DRAFT_07_SCHEMA = 'http://json-schema.org/draft-07/schema#';

const PRODUCT_LOOKUP_INPUT_SCHEMA = {
  $schema: DRAFT_07_SCHEMA,
  type: 'object',
  properties: {
    product_id: {
      description: 'Product ID from a prior search_products result',
      type: 'string',
      minLength: 1,
      maxLength: 80,
    },
    product_name: {
      description:
        'Exact product name from the catalog; call search_products first when unsure',
      type: 'string',
      minLength: 1,
      maxLength: 100,
    },
  },
  anyOf: [{ required: ['product_id'] }, { required: ['product_name'] }],
} as const;

const READ_ONLY_TOOL_ANNOTATIONS = {
  destructiveHint: false,
  openWorldHint: false,
  readOnlyHint: true,
} as const;

export const PUBLIC_MCP_TOOLS = [
  {
    name: 'search_products',
    title: 'Search Products',
    description: MCP_SEARCH_PRODUCTS_DESCRIPTION,
    inputSchema: {
      $schema: DRAFT_07_SCHEMA,
      type: 'object',
      properties: {
        intent: SEARCH_PRODUCTS_INTENT_SCHEMA,
        query: {
          description: 'Search query (product name, brand, or keywords)',
          type: 'string',
          maxLength: 100,
        },
        condition: {
          description: 'Product condition',
          type: 'string',
          enum: ['new', 'used', 'open_box', 'refurbished'],
        },
        category: {
          description: MCP_SEARCH_CATEGORY_GUIDANCE,
          type: 'string',
          maxLength: 50,
        },
        brand: {
          description: 'Brand name',
          type: 'string',
          maxLength: 50,
        },
        min_price: { type: 'number', minimum: 0 },
        max_price: { type: 'number', minimum: 0 },
        sort: {
          default: 'relevance',
          type: 'string',
          enum: ['price_asc', 'price_desc', 'newest', 'relevance'],
        },
        limit: { default: 10, type: 'number', minimum: 1, maximum: 20 },
      },
      required: ['intent'],
    },
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    name: 'add_to_cart',
    title: 'Add to Cart',
    description:
      'Prepare an Ogabassey cart handoff URL. A simple item is added when the shopper opens that URL; products with options open their selection page.',
    inputSchema: {
      $schema: DRAFT_07_SCHEMA,
      type: 'object',
      properties: {
        product_id: {
          type: 'string',
          description: 'The product ID to add to cart',
        },
        quantity: {
          default: 1,
          description: 'Quantity to add',
          type: 'integer',
          minimum: 1,
          maximum: 10,
        },
      },
      required: ['product_id'],
    },
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    name: 'get_product',
    title: 'Get Product Details',
    description: `Get detailed information about a specific product including variants, conditions, specifications, and reviews. Use product_id when available; otherwise use the exact product_name returned by search_products. ${MCP_OPTION_COLOR_EVIDENCE_GUIDANCE}`,
    inputSchema: PRODUCT_LOOKUP_INPUT_SCHEMA,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    name: 'get_store_info',
    title: 'Get Store Information',
    description: 'Get information about Ogabassey store.',
    inputSchema: {
      $schema: DRAFT_07_SCHEMA,
      type: 'object',
      properties: {
        topic: {
          description: 'Topic',
          type: 'string',
          enum: [
            'contact',
            'shipping',
            'returns',
            'payment',
            'general',
            'policies',
          ],
        },
      },
    },
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    name: 'get_product_variants',
    title: 'Get Product Variants',
    description: `Get all available variants (colors, storage options, conditions) for a product. Use product_id when available; otherwise use the exact product_name returned by search_products. ${MCP_OPTION_COLOR_EVIDENCE_GUIDANCE}`,
    inputSchema: PRODUCT_LOOKUP_INPUT_SCHEMA,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    name: 'browse_categories',
    title: 'Browse Categories',
    description: 'Get a list of product categories available in the store.',
    inputSchema: {
      $schema: DRAFT_07_SCHEMA,
      type: 'object',
      properties: {},
    },
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    name: 'get_brands',
    title: 'Get Available Brands',
    description: 'Get a list of brands available in the store.',
    inputSchema: {
      $schema: DRAFT_07_SCHEMA,
      type: 'object',
      properties: {
        category: {
          description: 'Filter brands by category',
          type: 'string',
          maxLength: 50,
        },
      },
    },
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    name: 'get_delivery_fee_info',
    title: 'Check Delivery Fee Information',
    description: MCP_DELIVERY_FEE_INFO_DESCRIPTION,
    inputSchema: z.toJSONSchema(mcpDeliveryFeeInfoInputSchema, {
      target: 'draft-7',
    }),
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
] as const;

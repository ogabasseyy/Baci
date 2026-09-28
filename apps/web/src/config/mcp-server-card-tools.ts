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
    description:
      'Search for products in Ogabassey store. Returns rich details including variants, stock confidence, and price trends. Always use this for general product queries.',
    inputSchema: {
      $schema: DRAFT_07_SCHEMA,
      type: 'object',
      properties: {
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
          description: 'Category (e.g., phones, laptops)',
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
    },
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    name: 'add_to_cart',
    title: 'Add to Cart',
    description:
      'Add a product to the shopping cart. This tool is accessible from the in-chat widget for real-time cart updates.',
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
          type: 'number',
          minimum: 1,
          maximum: 10,
        },
        session_id: {
          description: 'Cart session identifier',
          type: 'string',
        },
      },
      required: ['product_id'],
    },
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: false,
    },
  },
  {
    name: 'get_product',
    title: 'Get Product Details',
    description:
      'Get detailed information about a specific product including variants, conditions, specifications, and reviews. Use product_id when available; otherwise use the exact product_name returned by search_products.',
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
    description:
      'Get all available variants (colors, storage options, conditions) for a product. Use product_id when available; otherwise use the exact product_name returned by search_products.',
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
    name: 'get_shipping_quote',
    title: 'Calculate Delivery Fee',
    description:
      'Calculate shipping/delivery cost based on location. Provides real-time quotes from multiple carriers (GIGL, Topship).',
    inputSchema: {
      $schema: DRAFT_07_SCHEMA,
      type: 'object',
      properties: {
        state: {
          type: 'string',
          minLength: 2,
          maxLength: 50,
          description:
            'Nigerian state for delivery (e.g., Lagos, Abuja, Rivers)',
        },
        city: {
          description: 'City within the state',
          type: 'string',
          minLength: 2,
          maxLength: 100,
        },
        address: {
          description: 'Full delivery address',
          type: 'string',
          maxLength: 200,
        },
        product_ids: {
          description: 'Product IDs to calculate shipping for',
          maxItems: 20,
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 80 },
        },
        estimated_weight: {
          description:
            'Estimated total weight in kg (if products not specified)',
          type: 'number',
        },
      },
      required: ['state'],
    },
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
] as const;

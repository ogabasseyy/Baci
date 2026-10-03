export const DEFAULT_REQUIRED_TOOLS = [
  'add_to_cart',
  'browse_categories',
  'get_brands',
  'get_product',
  'get_product_variants',
  'get_delivery_fee_info',
  'get_store_info',
  'search_products',
];

export const DEFAULT_REQUIRED_TOOL_SCHEMA_CONTRACTS = {
  create_agentic_checkout_session: {
    itemArrayProperty: 'items',
    itemProperties: ['id', 'quantity'],
    properties: ['currency', 'idempotency_key', 'items', 'shipping_address'],
    required: ['items'],
  },
  update_agentic_checkout_session: {
    itemArrayProperty: 'items',
    itemProperties: ['id', 'quantity'],
    properties: [
      'fulfillment_option_id',
      'idempotency_key',
      'items',
      'session_id',
      'shipping_address',
    ],
    required: ['session_id'],
  },
};

export const DEFAULT_REQUIRED_TOOLS = [
  'prepare_storefront_cart_link',
  // Deprecated alias kept required until the compatibility window ends, so a
  // deployment that drops it fails the live smoke check instead of breaking
  // callers with cached tool lists (see server.ts registration + README).
  'add_to_cart',
  'update_ogabassey_guest_cart',
  'browse_categories',
  'get_brands',
  'get_product',
  'get_product_variants',
  'get_delivery_fee_info',
  'get_store_info',
  'search_products',
];

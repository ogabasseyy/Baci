export const MOBILE_ADMIN_PRODUCT_COLUMNS =
  'id, name, description, price, compare_at_price, cost_price, stock_quantity, stock, sku, slug, images, status, category, category_id, brand, brand_id, fulfillment_details, color, condition, variant_attributes, has_variants, manage_stock, low_stock_threshold, variant_model, migration_status, default_variant_id, available_conditions, min_variant_price, max_variant_price, inventory_tracking_policy, created_at, updated_at';

export const MOBILE_ADMIN_PRODUCT_WITH_RELATIONS_QUERY = `${MOBILE_ADMIN_PRODUCT_COLUMNS}, categories(name), brands(name)`;

export const WEB_PRODUCT_COLUMNS =
  'id, created_at, updated_at, merchant_id, name, description, price, compare_at_price, cost_price, stock, stock_quantity, manage_stock, low_stock_threshold, sku, slug, status, condition, condition_detail, brand, category, color, has_variants, variant_model, migration_status, default_variant_id, available_conditions, has_condition_offers, min_variant_price, max_variant_price, images, image_hint, weight_value, weight_unit, dimensions, taxable, tax_code, meta_title, meta_description, keywords, canonical_url, schema_markup, gtin, mpn, google_product_category, fulfillment_details, inventory_tracking_policy';

export const WEB_PRODUCT_COLUMNS_PUBLIC =
  'id, created_at, updated_at, merchant_id, name, description, price, compare_at_price, stock, stock_quantity, manage_stock, low_stock_threshold, sku, slug, status, condition, condition_detail, brand, category, color, has_variants, variant_model, migration_status, default_variant_id, available_conditions, has_condition_offers, min_variant_price, max_variant_price, images, image_hint, weight_value, weight_unit, dimensions, taxable, tax_code, meta_title, meta_description, keywords, canonical_url, schema_markup, gtin, mpn, google_product_category, inventory_tracking_policy';

export const WEB_PRODUCT_VARIANT_COLUMNS =
  'id, created_at, updated_at, product_id, merchant_id, condition, attributes, price_override, cost_price, stock_quantity, sku, primary_image, images, inventory_tracking_policy, is_inventory_anchor';

export const WEB_PRODUCT_VARIANT_COLUMNS_PUBLIC =
  'id, created_at, updated_at, product_id, merchant_id, condition, attributes, price_override, stock_quantity, sku, primary_image, images, inventory_tracking_policy, is_inventory_anchor';

export const WEB_PRODUCT_WITH_VARIANTS_QUERY = `${WEB_PRODUCT_COLUMNS}, variants:product_variants!product_variants_product_id_fkey(${WEB_PRODUCT_VARIANT_COLUMNS})`;

export const WEB_PRODUCT_WITH_VARIANTS_QUERY_PUBLIC = `${WEB_PRODUCT_COLUMNS_PUBLIC}, variants:product_variants!product_variants_product_id_fkey(${WEB_PRODUCT_VARIANT_COLUMNS_PUBLIC})`;

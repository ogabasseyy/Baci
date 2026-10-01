-- Drop the legacy three-column constraint only after the marketplace index is valid,
-- then attach the replacement as the table's named constraint.
ALTER TABLE public.jumia_product_mappings
  DROP CONSTRAINT IF EXISTS jumia_product_mappings_product_id_variant_id_jumia_shop_id_key;

DROP INDEX IF EXISTS public.jumia_product_mappings_product_variant_shop_uidx_next;

ALTER TABLE public.jumia_product_mappings
  ADD CONSTRAINT jumia_product_mappings_product_variant_shop_marketplace_key
  UNIQUE USING INDEX jumia_product_mappings_product_variant_shop_marketplace_uidx;

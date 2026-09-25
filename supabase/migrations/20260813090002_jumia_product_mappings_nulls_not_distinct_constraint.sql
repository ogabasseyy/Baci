-- Step 3: drop the legacy NULLS DISTINCT constraint only after the concurrent
-- replacement index is valid, then attach it as the table's named constraint.
ALTER TABLE public.jumia_product_mappings
  DROP CONSTRAINT IF EXISTS jumia_product_mappings_product_id_variant_id_jumia_shop_id_key;

ALTER TABLE public.jumia_product_mappings
  ADD CONSTRAINT jumia_product_mappings_product_id_variant_id_jumia_shop_id_key
  UNIQUE USING INDEX jumia_product_mappings_product_variant_shop_uidx_next;

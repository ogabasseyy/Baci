-- disable-transaction

-- Build the marketplace-scoped unique index without blocking writes to mappings.
DROP INDEX CONCURRENTLY IF EXISTS public.jumia_product_mappings_product_variant_shop_marketplace_uidx;

CREATE UNIQUE INDEX CONCURRENTLY jumia_product_mappings_product_variant_shop_marketplace_uidx
  ON public.jumia_product_mappings (product_id, variant_id, jumia_shop_id, marketplace_key)
  NULLS NOT DISTINCT;

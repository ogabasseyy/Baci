-- disable-transaction

-- Build the NULLS NOT DISTINCT unique index without blocking writes to mappings.
-- A failed concurrent build can leave an INVALID index, so retries remove only
-- the temporary artifact while the last valid production index remains available.
DROP INDEX CONCURRENTLY IF EXISTS public.jumia_product_mappings_product_variant_shop_uidx_next;

CREATE UNIQUE INDEX CONCURRENTLY jumia_product_mappings_product_variant_shop_uidx_next
  ON public.jumia_product_mappings (product_id, variant_id, jumia_shop_id)
  NULLS NOT DISTINCT;

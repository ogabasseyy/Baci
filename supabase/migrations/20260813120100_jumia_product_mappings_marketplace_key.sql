-- Scope Jumia product mappings per marketplace integration, not raw shop ID alone.

ALTER TABLE public.jumia_product_mappings
  ADD COLUMN IF NOT EXISTS marketplace_key text NOT NULL DEFAULT 'default';

UPDATE public.jumia_product_mappings AS mapping
SET marketplace_key = matched.marketplace_key
FROM (
  SELECT DISTINCT ON (mapping_inner.id)
    mapping_inner.id AS mapping_id,
    integration.marketplace_key
  FROM public.jumia_product_mappings AS mapping_inner
  JOIN public.marketplace_integrations AS integration
    ON integration.merchant_id = mapping_inner.merchant_id
    AND integration.platform = 'jumia'
    AND integration.shop_id = mapping_inner.jumia_shop_id
  WHERE mapping_inner.marketplace_key = 'default'
  ORDER BY
    mapping_inner.id,
    integration.is_active DESC,
    integration.updated_at DESC NULLS LAST,
    integration.created_at DESC NULLS LAST,
    integration.id DESC
) AS matched
WHERE mapping.id = matched.mapping_id;

DELETE FROM public.jumia_product_mappings AS duplicate
USING (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY product_id, variant_id, jumia_shop_id, marketplace_key
        ORDER BY
          updated_at DESC NULLS LAST,
          created_at DESC NULLS LAST,
          id DESC
      ) AS row_number
    FROM public.jumia_product_mappings
  ) ranked
  WHERE ranked.row_number > 1
) doomed
WHERE duplicate.id = doomed.id;

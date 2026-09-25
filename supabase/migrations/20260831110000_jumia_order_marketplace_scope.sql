-- Keep cached Jumia orders scoped to the marketplace integration that fetched them.
ALTER TABLE public.jumia_orders
  ADD COLUMN IF NOT EXISTS marketplace_key text;

-- Backfill only unambiguous legacy rows. Rows that could belong to more than
-- one active marketplace remain on the safe default until the next sync.
WITH unambiguous_matches AS (
  SELECT
    cached.id,
    min(integration.marketplace_key) AS marketplace_key
  FROM public.jumia_orders AS cached
  JOIN public.marketplace_integrations AS integration
    ON integration.merchant_id = cached.merchant_id
   AND integration.platform = 'jumia'
   AND coalesce(integration.shop_id, 'oauth') = cached.jumia_shop_id
   AND integration.is_active = true
  GROUP BY cached.id
  HAVING count(*) = 1
)
UPDATE public.jumia_orders AS cached
SET marketplace_key = matches.marketplace_key
FROM unambiguous_matches AS matches
WHERE cached.id = matches.id
  AND matches.marketplace_key IS NOT NULL;

UPDATE public.jumia_orders
SET marketplace_key = 'default'
WHERE marketplace_key IS NULL OR btrim(marketplace_key) = '';

ALTER TABLE public.jumia_orders
  ALTER COLUMN marketplace_key SET DEFAULT 'default',
  ALTER COLUMN marketplace_key SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jumia_orders_marketplace_scope
  ON public.jumia_orders (merchant_id, jumia_shop_id, marketplace_key);

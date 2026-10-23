-- Keep public repair-device typeahead work and payloads bounded while
-- preserving the table's existing public-catalog RLS policy.
CREATE OR REPLACE FUNCTION public.search_repair_devices(
  p_merchant_id uuid,
  p_query text
)
RETURNS TABLE (
  id uuid,
  brand text,
  model text,
  slug text,
  device_type text,
  product_id uuid,
  image_url text,
  aliases text[],
  sort_order integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    d.id,
    d.brand,
    d.model,
    d.slug,
    d.device_type,
    d.product_id,
    d.image_url,
    d.aliases,
    d.sort_order
  FROM public.repair_devices AS d
  WHERE d.merchant_id = p_merchant_id
    AND d.is_active
    AND p_query IS NOT NULL
    AND length(pg_catalog.btrim(p_query)) > 0
    AND (
      pg_catalog.strpos(pg_catalog.lower(d.brand), pg_catalog.lower(pg_catalog.btrim(p_query))) > 0
      OR pg_catalog.strpos(pg_catalog.lower(d.model), pg_catalog.lower(pg_catalog.btrim(p_query))) > 0
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.unnest(d.aliases) AS aliases(alias_value)
        WHERE pg_catalog.strpos(
          pg_catalog.lower(alias_value),
          pg_catalog.lower(pg_catalog.btrim(p_query))
        ) > 0
      )
    )
  ORDER BY d.sort_order, d.brand, d.model
  LIMIT 8;
$$;

REVOKE ALL ON FUNCTION public.search_repair_devices(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_repair_devices(uuid, text)
  TO anon, authenticated;

-- Keep the public catalog search complete while limiting typeahead suggestions.
CREATE OR REPLACE FUNCTION private.search_repair_devices_for_storefront(
  p_merchant_id uuid,
  p_query text,
  p_limit integer
)
RETURNS TABLE (
  id uuid, brand text, model text, slug text, device_type text,
  product_id uuid, image_url text, aliases text[], sort_order integer
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT d.id, d.brand, d.model, d.slug, d.device_type, d.product_id,
         d.image_url, d.aliases, d.sort_order
  FROM public.repair_devices AS d
  WHERE d.merchant_id = p_merchant_id
    AND d.is_active
    AND p_query IS NOT NULL
    AND length(pg_catalog.btrim(p_query)) > 0
    AND (
      pg_catalog.strpos(pg_catalog.lower(d.brand), pg_catalog.lower(pg_catalog.btrim(p_query))) > 0
      OR pg_catalog.strpos(pg_catalog.lower(d.model), pg_catalog.lower(pg_catalog.btrim(p_query))) > 0
      OR pg_catalog.strpos(
        pg_catalog.lower(pg_catalog.concat_ws(' ', d.brand, d.model)),
        pg_catalog.lower(pg_catalog.btrim(p_query))
      ) > 0
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.unnest(d.aliases) AS aliases(alias_value)
        WHERE pg_catalog.strpos(
          pg_catalog.lower(alias_value), pg_catalog.lower(pg_catalog.btrim(p_query))
        ) > 0
      )
    )
  ORDER BY d.sort_order, d.brand, d.model
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION private.search_repair_devices_for_storefront(uuid, text, integer) FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.search_repair_devices_for_storefront(uuid, text, integer)
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.search_repair_devices(p_merchant_id uuid, p_query text)
RETURNS TABLE (
  id uuid, brand text, model text, slug text, device_type text,
  product_id uuid, image_url text, aliases text[], sort_order integer
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT * FROM private.search_repair_devices_for_storefront(p_merchant_id, p_query, NULL);
$$;

CREATE OR REPLACE FUNCTION public.search_repair_device_suggestions(p_merchant_id uuid, p_query text)
RETURNS TABLE (
  id uuid, brand text, model text, slug text, device_type text,
  product_id uuid, image_url text, aliases text[], sort_order integer
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT * FROM private.search_repair_devices_for_storefront(p_merchant_id, p_query, 8);
$$;

REVOKE ALL ON FUNCTION public.search_repair_devices(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_repair_device_suggestions(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_repair_devices(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_repair_device_suggestions(uuid, text) TO anon, authenticated;

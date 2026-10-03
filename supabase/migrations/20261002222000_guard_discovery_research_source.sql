-- Atomically guard the exact source fields used for research, independently of facts.
-- Do not rely on updated_at: writers need not maintain a universal revision.
DROP FUNCTION public.update_product_discovery_metadata_guarded(uuid, uuid, jsonb, jsonb);
CREATE FUNCTION public.update_product_discovery_metadata_guarded(
  p_product_id uuid, p_merchant_id uuid, p_metadata jsonb,
  p_expected_metadata jsonb, p_expected_source jsonb
) RETURNS TABLE(id uuid)
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  UPDATE public.products AS p SET discovery_metadata = p_metadata
  WHERE p.id = p_product_id AND p.merchant_id = p_merchant_id
    AND p.discovery_metadata IS NOT DISTINCT FROM p_expected_metadata
    AND pg_catalog.jsonb_build_object(
      'name', p.name, 'category', p.category, 'metadata', p.metadata,
      'specifications', p.specifications, 'mpn', p.mpn, 'color', p.color
    ) = p_expected_source
  RETURNING p.id;
$$;
REVOKE ALL ON FUNCTION public.update_product_discovery_metadata_guarded(uuid, uuid, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_product_discovery_metadata_guarded(uuid, uuid, jsonb, jsonb, jsonb) TO authenticated;

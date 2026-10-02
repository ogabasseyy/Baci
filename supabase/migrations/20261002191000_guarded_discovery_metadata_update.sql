-- Keep optimistic snapshots in the RPC body; RLS remains authoritative.
CREATE OR REPLACE FUNCTION public.update_product_discovery_metadata_guarded(
  p_product_id uuid, p_merchant_id uuid, p_metadata jsonb, p_expected_metadata jsonb
) RETURNS TABLE(id uuid)
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  UPDATE public.products AS p SET discovery_metadata = p_metadata
  WHERE p.id = p_product_id AND p.merchant_id = p_merchant_id
    AND p.discovery_metadata IS NOT DISTINCT FROM p_expected_metadata
  RETURNING p.id;
$$;
REVOKE ALL ON FUNCTION public.update_product_discovery_metadata_guarded(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_product_discovery_metadata_guarded(uuid, uuid, jsonb, jsonb) TO authenticated;

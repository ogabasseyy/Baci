CREATE OR REPLACE FUNCTION public.claim_variant_inventory_units_for_order_item(
  p_merchant_id uuid,
  p_order_id uuid,
  p_order_item_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role'
     AND NOT public.has_merchant_access(p_merchant_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN private.claim_variant_inventory_units_for_order_item_internal(
    p_merchant_id,
    p_order_id,
    p_order_item_id
  );
END;
$$;

REVOKE ALL ON FUNCTION private.claim_variant_inventory_units_for_order_item_internal(uuid, uuid, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.claim_variant_inventory_units_for_order_item_internal(uuid, uuid, uuid)
TO service_role;

REVOKE ALL ON FUNCTION public.claim_variant_inventory_units_for_order_item(uuid, uuid, uuid)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_variant_inventory_units_for_order_item(uuid, uuid, uuid)
TO authenticated, service_role;

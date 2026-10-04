CREATE OR REPLACE FUNCTION public.confirm_order_inventory_reservations(
  p_merchant_id uuid,
  p_order_id uuid
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

  RETURN private.confirm_order_inventory_reservations(p_merchant_id, p_order_id);
END;
$$;

REVOKE ALL ON FUNCTION private.confirm_order_inventory_reservations(uuid, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.confirm_order_inventory_reservations(uuid, uuid)
TO service_role;

REVOKE ALL ON FUNCTION public.confirm_order_inventory_reservations(uuid, uuid)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_order_inventory_reservations(uuid, uuid)
TO authenticated, service_role;

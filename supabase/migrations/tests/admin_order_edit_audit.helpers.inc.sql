-- Include-only helper for admin_order_edit_audit.sql (no BEGIN/ROLLBACK): the suite loads it with \ir.
-- The helper is called after SET ROLE, so it needs an explicit GRANT (new functions are
-- not executable by other roles by default).

CREATE OR REPLACE FUNCTION pg_temp.manage_order_edit_variant_inventory_fixture(
  p_inventory_id uuid,
  p_order_id uuid,
  p_variant_id uuid,
  p_merchant_id uuid,
  p_should_delete boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_should_delete THEN
    DELETE FROM public.variant_inventory
    WHERE id = p_inventory_id;
    RETURN;
  END IF;

  INSERT INTO public.variant_inventory (
    id,
    variant_id,
    merchant_id,
    identifier_type,
    identifier_value,
    status,
    order_id,
    order_item_id,
    reserved_at,
    first_reserved_at,
    reservation_expires_at
  )
  SELECT
    p_inventory_id,
    p_variant_id,
    p_merchant_id,
    'imei',
    '123456789012345',
    'reserved',
    p_order_id,
    oi.id,
    now(),
    now(),
    now() + interval '15 minutes'
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id
  ORDER BY oi.id
  LIMIT 1;
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.manage_order_edit_variant_inventory_fixture(uuid, uuid, uuid, uuid, boolean) TO PUBLIC; -- called after SET ROLE

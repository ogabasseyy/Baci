-- Hold all affected products in canonical order before release touches any
-- inventory unit. Status-change stock synchronization also locks products.
DO $patch$
DECLARE
  definition text := pg_get_functiondef('private.release_order_inventory_units(uuid,uuid,text)'::regprocedure);
  anchor text := $old$  IF v_target_status = 'available' THEN$old$;
  replacement text := $new$  -- The order row is already locked, serializing claim/release for this order.
  PERFORM p.id
  FROM public.products p
  WHERE p.merchant_id = p_merchant_id AND EXISTS (
    SELECT 1
    FROM public.variant_inventory vi
    JOIN public.product_variants pv ON pv.id = vi.variant_id
    WHERE vi.order_id = p_order_id AND vi.merchant_id = p_merchant_id
      AND vi.status = 'reserved' AND pv.product_id = p.id
  )
  ORDER BY p.id
  FOR UPDATE OF p;

  IF v_target_status = 'available' THEN$new$;
BEGIN
  IF (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'serialized release product lock source mismatch';
  END IF;
  EXECUTE replace(definition, anchor, replacement);
END $patch$;

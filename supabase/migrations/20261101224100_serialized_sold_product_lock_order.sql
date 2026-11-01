-- Payment-time sale follows the same order, product, then unit lock order
-- as reservation release and merchant edits.
DO $patch$
DECLARE
  definition text := pg_get_functiondef('private.mark_order_inventory_units_sold(uuid,uuid)'::regprocedure);
  anchor text := $old$  FOR v_unit IN$old$;
  replacement text := $new$  PERFORM p.id
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

  FOR v_unit IN$new$;
BEGIN
  IF (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'serialized sold product lock source mismatch';
  END IF;
  EXECUTE replace(definition, anchor, replacement);
END $patch$;

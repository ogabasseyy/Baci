-- Offer cleanup must take product locks before units, matching merchant edits.
-- Lock every affected product in canonical order, including legacy mismatches.
DO $patch$
DECLARE
  definition text := pg_get_functiondef('private.release_stale_offer_line_serialized_units(uuid,uuid,uuid,uuid,jsonb)'::regprocedure);
  anchor text := $old$  PERFORM 1 FROM public.order_items WHERE id = p_item_id FOR UPDATE;$old$;
  replacement text := $new$  PERFORM 1 FROM public.order_items WHERE id = p_item_id FOR UPDATE;
  PERFORM p.id
  FROM public.products p
  WHERE p.merchant_id = p_merchant_id AND EXISTS (
    SELECT 1 FROM public.variant_inventory vi
    JOIN public.product_variants pv ON pv.id = vi.variant_id
    WHERE vi.order_item_id = p_item_id AND vi.status = 'reserved'
      AND vi.merchant_id = p_merchant_id AND vi.order_id = p_order_id
      AND pv.product_id = p.id
  )
  ORDER BY p.id
  FOR UPDATE OF p;$new$;
BEGIN
  IF (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'serialized offer cleanup lock source mismatch';
  END IF;
  EXECUTE replace(definition, anchor, replacement);
END $patch$;

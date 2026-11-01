-- An untransferred serialized prize must lock products before its unit, as
-- merchant edits and ordinary order releases do. Include the actual unit's
-- product as well as the reservation snapshot for legacy inconsistencies.
DO $patch$
DECLARE
  definition text := replace(pg_get_functiondef('private.release_quiz_prize_reservation_v2(uuid,text)'::regprocedure), E'\r\n', E'\n');
  anchor text := $old$  ELSIF v_res.inventory_unit_id IS NOT NULL THEN
    UPDATE public.variant_inventory SET status = 'available'$old$;
  replacement text := $new$  ELSIF v_res.inventory_unit_id IS NOT NULL THEN
    PERFORM p.id
    FROM public.products p
    WHERE p.merchant_id = v_res.merchant_id AND (
      p.id = v_res.product_id OR EXISTS (
        SELECT 1 FROM public.variant_inventory vi
        JOIN public.product_variants pv ON pv.id = vi.variant_id
        WHERE vi.id = v_res.inventory_unit_id AND pv.product_id = p.id
      )
    )
    ORDER BY p.id
    FOR UPDATE OF p;

    UPDATE public.variant_inventory SET status = 'available'$new$;
BEGIN
  IF (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'serialized quiz release lock source mismatch';
  END IF;
  EXECUTE replace(definition, anchor, replacement);
END $patch$;

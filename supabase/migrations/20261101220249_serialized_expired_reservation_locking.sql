-- Each order is selected once and locked before its products and units.
DO $patch$
DECLARE
  definition text := replace(pg_get_functiondef('private.release_expired_variant_inventory_reservations(uuid,timestamptz,integer)'::regprocedure), E'\r\n', E'\n');
  old_candidates text := $old$    SELECT DISTINCT o.id, o.merchant_id
    FROM public.orders o
    JOIN public.variant_inventory vi ON vi.order_id = o.id
    WHERE vi.status = 'reserved'
      AND vi.reservation_expires_at IS NOT NULL
      AND vi.reservation_expires_at <= p_reference_time$old$;
  new_candidates text := $new$    SELECT o.id, o.merchant_id
    FROM public.orders o
    WHERE EXISTS (
      SELECT 1 FROM public.variant_inventory vi
      WHERE vi.order_id = o.id AND vi.merchant_id = o.merchant_id
        AND vi.status = 'reserved'
        AND vi.reservation_expires_at IS NOT NULL
        AND vi.reservation_expires_at <= p_reference_time
    )$new$;
  old_items text := $old$    -- Re-evaluate each item/unit under order lock$old$;
  new_items text := $new$    -- Match checkout and merchant-edit product-before-unit lock ordering.
    PERFORM p.id
    FROM public.products p
    WHERE p.merchant_id = v_merchant_id AND (EXISTS (
      SELECT 1 FROM public.order_items oi
      WHERE oi.order_id = v_order.id AND oi.product_id = p.id
    ) OR EXISTS (
      SELECT 1 FROM public.variant_inventory vi
      JOIN public.product_variants pv ON pv.id = vi.variant_id
      WHERE vi.order_id = v_order.id AND vi.merchant_id = v_merchant_id
        AND vi.status = 'reserved' AND pv.product_id = p.id
        AND vi.reservation_expires_at IS NOT NULL
        AND vi.reservation_expires_at <= p_reference_time
    ))
    ORDER BY p.id
    FOR UPDATE OF p;

    -- Re-evaluate each item/unit under order lock$new$;
BEGIN
  IF (length(definition) - length(replace(definition, old_candidates, ''))) / length(old_candidates) <> 1
    OR (length(definition) - length(replace(definition, old_items, ''))) / length(old_items) <> 1 THEN
    RAISE EXCEPTION 'serialized expired reservation source mismatch';
  END IF;
  EXECUTE replace(replace(definition, old_candidates, new_candidates), old_items, new_items);
END $patch$;

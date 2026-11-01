-- Only order creation may record this marker. Legacy offer orders predate
-- serialized condition units and must retain #3813's stale-release behavior.
CREATE TABLE IF NOT EXISTS private.serialized_offer_order_items (
  order_item_id uuid PRIMARY KEY REFERENCES public.order_items(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL,
  offer_id uuid NOT NULL
);
ALTER TABLE private.serialized_offer_order_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.serialized_offer_order_items FROM PUBLIC, anon, authenticated, service_role;

DO $$
DECLARE
  v_def text := pg_catalog.pg_get_functiondef('private.confirm_order_inventory_reservations(uuid,uuid)'::regprocedure);
  v_old text;
  v_new text;
BEGIN
  -- #3813 adds fields already projected by the condition-aware patch.
  v_old := $old$, oi.offer_line, oi.product_offer_id, oi.offer_labels_snapshotted
    FROM public.order_items oi$old$;
  v_new := $new$, oi.offer_labels_snapshotted
    FROM public.order_items oi$new$;
  IF (length(v_def)-length(replace(v_def,v_old,''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'serialized offer confirmation legacy projection mismatch';
  END IF;
  v_def := replace(v_def,v_old,v_new);

  v_old := $old$    IF v_item.offer_line IS TRUE OR v_item.product_offer_id IS NOT NULL OR v_item.offer_labels_snapshotted IS TRUE THEN$old$;
  v_new := $new$    IF (v_item.offer_line IS TRUE OR v_item.product_offer_id IS NOT NULL OR v_item.offer_labels_snapshotted IS TRUE)
      AND NOT EXISTS (SELECT 1 FROM private.serialized_offer_order_items marker
        WHERE marker.order_item_id = v_item.id) THEN$new$;
  IF (length(v_def)-length(replace(v_def,v_old,''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'serialized offer confirmation legacy branch mismatch';
  END IF;
  v_def := replace(v_def,v_old,v_new);

  v_old := $old$    IF (v_item.product_offer_id IS NOT NULL AND v_item.offer_id IS NOT NULL$old$;
  v_new := $new$    IF EXISTS (SELECT 1 FROM private.serialized_offer_order_items marker
        WHERE marker.order_item_id = v_item.id AND (marker.merchant_id IS DISTINCT FROM p_merchant_id
          OR marker.offer_id IS DISTINCT FROM v_condition_offer_id))
      OR (v_item.product_offer_id IS NOT NULL AND v_item.offer_id IS NOT NULL$new$;
  IF (length(v_def)-length(replace(v_def,v_old,''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'serialized offer confirmation identity mismatch';
  END IF;
  v_def := replace(v_def,v_old,v_new);
  v_old := $old$    SET fulfillment_data = v_fulfillment_data
    WHERE id = v_item.id;$old$;
  v_new := $new$    SET fulfillment_data = CASE WHEN EXISTS (SELECT 1 FROM private.serialized_offer_order_items marker WHERE marker.order_item_id = v_item.id)
      THEN (coalesce(fulfillment_data, '{}'::jsonb) - 'serializedInventoryException') || v_fulfillment_data
      ELSE v_fulfillment_data END
    WHERE id = v_item.id;$new$;
  IF (length(v_def)-length(replace(v_def,v_old,''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'serialized confirmation fulfillment mismatch';
  END IF;
  v_def := replace(v_def,v_old,v_new);
  v_old := $old$      UPDATE public.order_items SET fulfillment_data = jsonb_build_object($old$;
  v_new := $new$      UPDATE public.order_items SET fulfillment_data = coalesce(fulfillment_data, '{}'::jsonb) || jsonb_build_object($new$;
  IF (length(v_def)-length(replace(v_def,v_old,''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'serialized confirmation exception snapshot mismatch';
  END IF;
  EXECUTE replace(v_def,v_old,v_new);
END;
$$;

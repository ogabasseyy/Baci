-- Bind claims to the private order-protocol marker and preserve valid
-- condition reservations during checkout reuse. Legacy offers continue
-- through #3813's stale-release branch.
DO $$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  v_def := pg_catalog.pg_get_functiondef('private.claim_variant_inventory_units_for_order_item_internal(uuid,uuid,uuid)'::regprocedure);
  v_old := $old$  IF v_effective_policy = 'off' THEN
    RETURN jsonb_build_object('policy', 'off');
  END IF;$old$;
  v_new := $new$  IF v_effective_policy = 'off' THEN
    IF EXISTS (SELECT 1 FROM private.serialized_offer_order_items marker WHERE marker.order_item_id = p_order_item_id) THEN
      RAISE EXCEPTION 'serialized_offer_policy_changed' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('policy', 'off');
  END IF;$new$;
  IF (length(v_def)-length(replace(v_def,v_old,''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'serialized claim policy source mismatch';
  END IF;
  v_def := replace(v_def,v_old,v_new);
  v_old := $old$  v_condition_offer_id := coalesce(v_product_offer_id, v_exact_offer_id, v_offer_id_snapshot);$old$;
  v_new := $new$  v_condition_offer_id := coalesce(v_product_offer_id, v_exact_offer_id, v_offer_id_snapshot);
  IF EXISTS (SELECT 1 FROM private.serialized_offer_order_items marker
    WHERE marker.order_item_id = p_order_item_id AND
      (marker.merchant_id IS DISTINCT FROM p_merchant_id OR marker.offer_id IS DISTINCT FROM v_condition_offer_id)) THEN
    RAISE EXCEPTION 'serialized_offer_identity_mismatch' USING ERRCODE = '22023';
  END IF;$new$;
  IF (length(v_def)-length(replace(v_def,v_old,''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'serialized claim protocol source mismatch';
  END IF;
  v_def := replace(v_def,v_old,v_new);
  v_old := $old$  SET fulfillment_data = v_fulfillment_data
  WHERE id = p_order_item_id;$old$;
  v_new := $new$  SET fulfillment_data = CASE WHEN EXISTS (SELECT 1 FROM private.serialized_offer_order_items marker WHERE marker.order_item_id = p_order_item_id)
    THEN coalesce(fulfillment_data, '{}'::jsonb) || v_fulfillment_data ELSE v_fulfillment_data END
  WHERE id = p_order_item_id;$new$;
  IF (length(v_def)-length(replace(v_def,v_old,''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'serialized claim fulfillment source mismatch';
  END IF;
  EXECUTE replace(v_def,v_old,v_new);

  v_def := pg_catalog.pg_get_functiondef('private.prepare_storefront_order_for_checkout(uuid,uuid,text,text,text,text,uuid,jsonb,boolean)'::regprocedure);
  v_old := $old$  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.variant_inventory$old$;
  v_new := $new$  LOOP
    IF EXISTS (SELECT 1 FROM private.serialized_offer_order_items marker
      WHERE marker.order_item_id = v_item.id) THEN
      PERFORM private.claim_variant_inventory_units_for_order_item_internal(p_merchant_id, p_order_id, v_item.id);
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM public.variant_inventory$new$;
  IF (length(v_def)-length(replace(v_def,v_old,''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'serialized checkout reuse loop mismatch';
  END IF;
  v_def := replace(v_def,v_old,v_new);

  v_old := $old$    IF v_item.offer_line IS TRUE OR v_item.product_offer_id IS NOT NULL OR v_item.offer_labels_snapshotted IS TRUE THEN$old$;
  v_new := $new$    IF (v_item.offer_line IS TRUE OR v_item.product_offer_id IS NOT NULL OR v_item.offer_labels_snapshotted IS TRUE)
      AND NOT EXISTS (SELECT 1 FROM private.serialized_offer_order_items marker
        WHERE marker.order_item_id = v_item.id) THEN$new$;
  IF (length(v_def)-length(replace(v_def,v_old,''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'serialized checkout reuse legacy branch mismatch';
  END IF;
  v_def := replace(v_def,v_old,v_new);
  v_old := $old$        SET fulfillment_data = jsonb_build_object($old$;
  v_new := $new$        SET fulfillment_data = CASE WHEN EXISTS (SELECT 1 FROM private.serialized_offer_order_items marker WHERE marker.order_item_id = v_item.id)
          THEN coalesce(oi.fulfillment_data, '{}'::jsonb) ELSE '{}'::jsonb END || jsonb_build_object($new$;
  IF (length(v_def)-length(replace(v_def,v_old,''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'serialized checkout reuse fulfillment mismatch';
  END IF;
  EXECUTE replace(v_def,v_old,v_new);
END;
$$;

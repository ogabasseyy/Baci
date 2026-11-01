-- Late payment confirmation must never reclaim another condition's unit.
-- Keep the existing exception reporting for shortages rather than rejecting
-- payment recording after the fact.
CREATE OR REPLACE FUNCTION pg_temp.patch_serialized_offer_confirmation(old text, replacement text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE definition text := pg_catalog.pg_get_functiondef('private.confirm_order_inventory_reservations(uuid,uuid)'::regprocedure);
BEGIN
  IF old = '' OR (length(definition) - length(replace(definition, old, ''))) / length(old) <> 1 THEN
    RAISE EXCEPTION 'serialized confirmation source mismatch';
  END IF;
  EXECUTE replace(definition, old, replacement);
END;
$$;
SELECT pg_temp.patch_serialized_offer_confirmation(
  $old$  v_actual_variant_id uuid;$old$,
  $new$  v_actual_variant_id uuid;
  v_condition_offer_id uuid;
  v_can_reclaim boolean;
  v_active_branch_count integer;
  v_only_active_branch_id uuid;$new$
);
SELECT pg_temp.patch_serialized_offer_confirmation(
  $old$    SELECT oi.id, oi.product_id, oi.variant_id, oi.quantity$old$,
  $new$    SELECT oi.id, oi.product_id, oi.variant_id, oi.quantity,
      oi.product_offer_id, oi.offer_id, oi.offer_id_snapshot, coalesce(oi.offer_line, false) AS offer_line$new$
);
SELECT pg_temp.patch_serialized_offer_confirmation(
  $old$    FROM public.products
    WHERE id = v_item.product_id AND merchant_id = p_merchant_id;$old$,
  $new$    FROM public.products
    WHERE id = v_item.product_id AND merchant_id = p_merchant_id
    FOR UPDATE;$new$
);
SELECT pg_temp.patch_serialized_offer_confirmation(
  $old$    IF v_effective_policy = 'off' THEN
      CONTINUE;
    END IF;$old$,
  $new$    IF v_effective_policy = 'off' THEN
      CONTINUE;
    END IF;

    v_condition_offer_id := coalesce(v_item.product_offer_id, v_item.offer_id, v_item.offer_id_snapshot);
    v_can_reclaim := v_condition_offer_id IS NULL OR v_item.product_offer_id IS NOT NULL OR v_item.offer_id IS NOT NULL;
    IF (v_item.product_offer_id IS NOT NULL AND v_item.offer_id IS NOT NULL
        AND v_item.product_offer_id IS DISTINCT FROM v_item.offer_id)
      OR (v_item.offer_id_snapshot IS NOT NULL AND coalesce(v_item.product_offer_id, v_item.offer_id) IS NOT NULL
        AND v_item.offer_id_snapshot IS DISTINCT FROM coalesce(v_item.product_offer_id, v_item.offer_id))
      OR (v_item.offer_line AND v_condition_offer_id IS NULL)
      OR EXISTS (SELECT 1 FROM public.variant_inventory AS vi WHERE vi.order_item_id = v_item.id
        AND vi.condition_offer_id IS DISTINCT FROM v_condition_offer_id) THEN
      v_total_missing_count := v_total_missing_count + v_item.quantity;
      v_exceptions := v_exceptions || jsonb_build_object('itemId', v_item.id, 'code', 'serialized_offer_identity_mismatch');
      UPDATE public.order_items SET fulfillment_data = jsonb_build_object(
        'source', 'merchant_stock', 'reservationExpiresAt', null, 'inventoryUnits', '[]'::jsonb,
        'missingUnitCount', v_item.quantity,
        'serializedInventoryException', jsonb_build_object('code', 'serialized_offer_identity_mismatch')
      ) WHERE id = v_item.id;
      CONTINUE;
    END IF;
    v_only_active_branch_id := NULL;
    IF v_condition_offer_id IS NOT NULL AND v_order.branch_id IS NULL THEN
      SELECT count(*)::integer, (array_agg(b.id))[1] INTO v_active_branch_count, v_only_active_branch_id
      FROM public.branches AS b WHERE b.merchant_id = p_merchant_id AND b.active IS TRUE;
      IF v_active_branch_count <> 1 THEN v_only_active_branch_id := NULL; END IF;
    END IF;$new$
);
SELECT pg_temp.patch_serialized_offer_confirmation(
  $old$          AND vi.variant_id = v_actual_variant_id
          AND vi.status = 'available'$old$,
  $new$          AND vi.variant_id = v_actual_variant_id
          AND vi.condition_offer_id IS NOT DISTINCT FROM v_condition_offer_id
          AND v_can_reclaim
          AND vi.status = 'available'$new$
);
SELECT pg_temp.patch_serialized_offer_confirmation(
  $old$            (v_order.branch_id IS NULL AND vi.branch_id IS NULL)$old$,
  $new$            (v_order.branch_id IS NULL AND (vi.branch_id IS NULL OR vi.branch_id = v_only_active_branch_id))$new$
);

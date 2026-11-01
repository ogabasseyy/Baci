-- Keep normal and condition-offer claims in separate serialized pools. The
-- public condition-offer gate remains closed until availability and order
-- creation are updated in the same release.
CREATE OR REPLACE FUNCTION pg_temp.patch_serialized_offer_claim(old text, replacement text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  definition text := pg_catalog.pg_get_functiondef(
    'private.claim_variant_inventory_units_for_order_item_internal(uuid,uuid,uuid)'::regprocedure
  );
BEGIN
  IF old = '' OR (length(definition) - length(replace(definition, old, ''))) / length(old) <> 1 THEN
    RAISE EXCEPTION 'serialized offer claim source mismatch';
  END IF;
  EXECUTE replace(definition, old, replacement);
END;
$$;

SELECT pg_temp.patch_serialized_offer_claim(
  $old$  v_qty integer;$old$,
  $new$  v_qty integer;
  v_product_offer_id uuid;
  v_exact_offer_id uuid;
  v_offer_id_snapshot uuid;
  v_offer_line boolean;
  v_condition_offer_id uuid;
  v_active_branch_count integer;
  v_only_active_branch_id uuid;$new$
);
SELECT pg_temp.patch_serialized_offer_claim(
  $old$  SELECT oi.product_id, oi.variant_id, oi.quantity, o.branch_id, o.payment_status, o.payment_method
  INTO v_product_id, v_variant_id, v_qty, v_order_branch_id, v_payment_status, v_payment_method$old$,
  $new$  SELECT oi.product_id, oi.variant_id, oi.quantity, o.branch_id, o.payment_status, o.payment_method,
    oi.product_offer_id, oi.offer_id, oi.offer_id_snapshot, coalesce(oi.offer_line, false)
  INTO v_product_id, v_variant_id, v_qty, v_order_branch_id, v_payment_status, v_payment_method,
    v_product_offer_id, v_exact_offer_id, v_offer_id_snapshot, v_offer_line$new$
);
SELECT pg_temp.patch_serialized_offer_claim(
  $old$  FROM public.products
  WHERE id = v_product_id AND merchant_id = p_merchant_id;$old$,
  $new$  FROM public.products
  WHERE id = v_product_id AND merchant_id = p_merchant_id
  FOR UPDATE;$new$
);
SELECT pg_temp.patch_serialized_offer_claim(
  $old$  IF v_effective_policy = 'off' THEN
    RETURN jsonb_build_object('policy', 'off');
  END IF;$old$,
  $new$  IF v_effective_policy = 'off' THEN
    RETURN jsonb_build_object('policy', 'off');
  END IF;

  IF v_product_offer_id IS NOT NULL AND v_exact_offer_id IS NOT NULL
    AND v_product_offer_id IS DISTINCT FROM v_exact_offer_id THEN
    RAISE EXCEPTION 'serialized_offer_identity_mismatch' USING ERRCODE = '22023';
  END IF;
  IF v_offer_id_snapshot IS NOT NULL AND coalesce(v_product_offer_id, v_exact_offer_id) IS NOT NULL
    AND v_offer_id_snapshot IS DISTINCT FROM coalesce(v_product_offer_id, v_exact_offer_id) THEN
    RAISE EXCEPTION 'serialized_offer_identity_mismatch' USING ERRCODE = '22023';
  END IF;
  v_condition_offer_id := coalesce(v_product_offer_id, v_exact_offer_id, v_offer_id_snapshot);
  IF v_offer_line AND v_condition_offer_id IS NULL THEN
    RAISE EXCEPTION 'serialized_offer_no_longer_available' USING ERRCODE = '55000';
  END IF;
  IF v_offer_id_snapshot IS NOT NULL AND v_product_offer_id IS NULL AND v_exact_offer_id IS NULL
    AND (SELECT count(*) FROM public.variant_inventory AS vi
      WHERE vi.order_item_id = p_order_item_id AND vi.condition_offer_id = v_offer_id_snapshot) < v_qty THEN
    RAISE EXCEPTION 'serialized_offer_no_longer_available' USING ERRCODE = '55000';
  END IF;
  IF v_condition_offer_id IS NOT NULL AND v_order_branch_id IS NULL THEN
    SELECT count(*)::integer, (array_agg(b.id))[1]
      INTO v_active_branch_count, v_only_active_branch_id
    FROM public.branches AS b WHERE b.merchant_id = p_merchant_id AND b.active IS TRUE;
    IF v_active_branch_count <> 1 THEN
      v_only_active_branch_id := NULL;
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.variant_inventory AS vi
    WHERE vi.order_item_id = p_order_item_id
      AND vi.condition_offer_id IS DISTINCT FROM v_condition_offer_id
  ) THEN
    RAISE EXCEPTION 'serialized_offer_reservation_mismatch' USING ERRCODE = '55000';
  END IF;$new$
);
SELECT pg_temp.patch_serialized_offer_claim(
  $old$        AND vi.variant_id = v_variant_id
        AND vi.status = 'available'$old$,
  $new$        AND vi.variant_id = v_variant_id
        AND vi.condition_offer_id IS NOT DISTINCT FROM v_condition_offer_id
        AND vi.status = 'available'$new$
);
SELECT pg_temp.patch_serialized_offer_claim(
  $old$          (v_order_branch_id IS NULL AND vi.branch_id IS NULL)$old$,
  $new$          (v_order_branch_id IS NULL AND (vi.branch_id IS NULL OR vi.branch_id = v_only_active_branch_id))$new$
);

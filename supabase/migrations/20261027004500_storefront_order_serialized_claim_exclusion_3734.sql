-- Issue #3734: serialized units are claimed for condition-offer lines
-- (double reservation risk: offer stock decremented AND base-product
-- units reserved, or serialized_inventory_unavailable in strict mode).
--
-- The creation exclusion in private.create_storefront_order_unchecked
-- re-derived offer identity from a staging (product, variant,
-- condition) tuple. That misses offer_id-only lines when the live
-- offer condition differs from the product fallback, and wrongly
-- catches plain lines whose condition merely equals an offer's. The
-- fix keys the creation loop on the persisted line identity instead:
-- order_items.offer_line (true for offer_id or condition_offer_id
-- lines) and product_offer_id, both written by the insert list and the
-- identity trigger. Plain lines can no longer be mis-excluded, and
-- offer lines can no longer slip through on a condition mismatch.
--
-- The same gap exists in the pending-order reuse path:
-- private.prepare_storefront_order_for_checkout iterates every order
-- item and claims serialized units whenever none are reserved, with no
-- offer-line exclusion at all. The reuse loop now selects the same
-- persisted markers and skips the claim for offer lines. Because the
-- pre-fix code ran unguarded, legacy orders may already hold wrongly
-- reserved units (reserved or non-expiring): the reuse loop releases
-- them (reservation_released events, units detached, fulfillment_data
-- rewritten) instead of refreshing expiry, and skips the claim.
--
-- The payment-confirmation path had the same hole:
-- private.confirm_order_inventory_reservations iterated every item and
-- reclaimed units for held lines (or raised late_payment_reservation_lost
-- for strict policies). It now releases stale reservations on offer
-- lines first, then skips them; fulfillment_data is rewritten so freed
-- units are not listed as assigned.
--
-- Legacy marker shape: rows created before 20261019100000 may carry
-- product_offer_id with offer_line false (the backfill keyed on
-- offer_id; the trigger derives from both only since 19100000).
-- Reuse and confirm guards therefore key on either marker, matching
-- the current trigger definition. Required source shape is asserted
-- so schema drift fails closed (same pg_get_functiondef string-patch
-- pattern as 15140000).
DO $claim_exclusion_3734$
DECLARE
  function_oid oid;
  definition text;
  old_marker text := $marker$        AND NOT EXISTS(SELECT 1 FROM pg_temp.tmp_storefront_order_items t WHERE t.condition_offer_id IS NOT NULL AND t.product_id=oi.product_id AND t.variant_id IS NOT DISTINCT FROM oi.variant_id AND t.condition IS NOT DISTINCT FROM oi.condition)$marker$;
  new_marker text := $marker$        AND oi.offer_line IS DISTINCT FROM TRUE
        AND oi.product_offer_id IS NULL$marker$;
BEGIN
  SELECT p.oid INTO STRICT function_oid
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private' AND p.proname = 'create_storefront_order_unchecked' AND p.pronargs = 24;
  definition := pg_catalog.pg_get_functiondef(function_oid);
  IF position(new_marker IN definition) > 0 THEN RETURN; END IF;
  IF position(old_marker IN definition) = 0 THEN
    RAISE EXCEPTION 'serialized claim exclusion source does not match expected shape';
  END IF;
  IF (length(definition) - length(replace(definition, old_marker, ''))) <> length(old_marker) THEN
    RAISE EXCEPTION 'serialized claim exclusion anchor is not unique';
  END IF;
  definition := replace(definition, old_marker, new_marker);
  EXECUTE definition;
END $claim_exclusion_3734$;
DO $claim_exclusion_prepare_3734$
DECLARE
  function_oid oid;
  definition text;
  old_loop text := $marker$  FOR v_item IN
    SELECT oi.id, oi.product_id, oi.variant_id, oi.quantity
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
    ORDER BY oi.product_id, oi.variant_id, oi.id
    FOR UPDATE
  LOOP$marker$;
  new_loop text := $marker$  FOR v_item IN
    SELECT oi.id, oi.product_id, oi.variant_id, oi.quantity, oi.offer_line, oi.product_offer_id
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
    ORDER BY oi.product_id, oi.variant_id, oi.id
    FOR UPDATE
  LOOP$marker$;
  old_claim text := $marker$    ELSE
      PERFORM private.claim_variant_inventory_units_for_order_item_internal(
        p_merchant_id,
        p_order_id,
        v_item.id
      );
    END IF;$marker$;
  new_claim text := $marker$    ELSIF v_item.offer_line IS DISTINCT FROM TRUE AND v_item.product_offer_id IS NULL THEN
      PERFORM private.claim_variant_inventory_units_for_order_item_internal(
        p_merchant_id,
        p_order_id,
        v_item.id
      );
    END IF;$marker$;
  old_reserved text := $marker$    IF v_has_reserved THEN
      IF v_is_pod THEN$marker$;
  new_reserved text := $marker$    IF v_item.offer_line IS TRUE OR v_item.product_offer_id IS NOT NULL THEN
      -- Offer lines are fulfilled from offer stock: release units the
      -- pre-fix loop wrongly reserved (reserved or non-expiring)
      -- instead of refreshing them, then skip the claim branch below.
      -- The unit's own variant/branch/product is logged (order lines
      -- on simple products carry NULL variant_id; the unit sits on
      -- the anchor variant). Attributes are read in a second step
      -- because FOR UPDATE cannot lock the nullable side of the
      -- outer join. Fulfillment_data is rewritten so freed units are
      -- not listed as assigned to the offer line.
      DECLARE
        v_release_id uuid;
        v_release_variant_id uuid;
        v_release_product_id uuid;
        v_release_branch_id uuid;
        v_release_from_status text;
      BEGIN
        FOR v_release_id IN
          SELECT vi.id FROM public.variant_inventory vi
          WHERE vi.order_item_id = v_item.id AND vi.status IN ('reserved', 'non-expiring')
          FOR UPDATE
        LOOP
          SELECT vi.variant_id, pv.product_id, vi.branch_id, vi.status
          INTO v_release_variant_id, v_release_product_id, v_release_branch_id, v_release_from_status
          FROM public.variant_inventory vi
          LEFT JOIN public.product_variants pv ON pv.id = vi.variant_id
          WHERE vi.id = v_release_id;
          PERFORM private.record_variant_inventory_event(
            v_release_id, p_merchant_id, COALESCE(v_release_product_id, v_item.product_id), v_release_variant_id, 'reservation_released',
            v_release_from_status, 'available', p_order_id, v_item.id, v_release_branch_id, NULL, NULL,
jsonb_build_object('releaseReason', 'checkout_reuse')
          );
          UPDATE public.variant_inventory
          SET status = 'available',
              order_id = NULL,
              order_item_id = NULL,
              reserved_at = NULL,
              reservation_expires_at = NULL,
              updated_at = now()
          WHERE id = v_release_id;
        END LOOP;
        UPDATE public.order_items AS oi
        SET fulfillment_data = jsonb_build_object(
          'source', 'merchant_stock',
          'reservationExpiresAt', NULL,
          'inventoryUnits', '[]'::jsonb,
          'missingUnitCount', v_item.quantity
        )
        WHERE oi.id = v_item.id;
      END;
    ELSIF v_has_reserved THEN
      IF v_is_pod THEN$marker$;
BEGIN
  SELECT p.oid INTO STRICT function_oid
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private' AND p.proname = 'prepare_storefront_order_for_checkout' AND p.pronargs = 9;
  definition := pg_catalog.pg_get_functiondef(function_oid);
  IF position(new_loop IN definition) > 0
     AND position(new_claim IN definition) > 0
     AND position(new_reserved IN definition) > 0 THEN RETURN; END IF;
  IF position(old_loop IN definition) = 0 THEN
    RAISE EXCEPTION 'reuse claim loop source does not match expected shape';
  END IF;
  IF position(old_claim IN definition) = 0 THEN
    RAISE EXCEPTION 'reuse claim branch source does not match expected shape';
  END IF;
  IF position(old_reserved IN definition) = 0 THEN
    RAISE EXCEPTION 'reuse reserved branch source does not match expected shape';
  END IF;
  IF (length(definition) - length(replace(definition, old_loop, ''))) <> length(old_loop) THEN
    RAISE EXCEPTION 'reuse claim loop anchor is not unique';
  END IF;
  IF (length(definition) - length(replace(definition, old_claim, ''))) <> length(old_claim) THEN
    RAISE EXCEPTION 'reuse claim branch anchor is not unique';
  END IF;
  IF (length(definition) - length(replace(definition, old_reserved, ''))) <> length(old_reserved) THEN
    RAISE EXCEPTION 'reuse reserved branch anchor is not unique';
  END IF;
  definition := replace(definition, old_loop, new_loop);
  definition := replace(definition, old_claim, new_claim);
  definition := replace(definition, old_reserved, new_reserved);
  EXECUTE definition;
END $claim_exclusion_prepare_3734$;
DO $claim_exclusion_confirm_3734$
DECLARE
  function_oid oid;
  definition text;
  old_cselect text := $marker$  FOR v_item IN
    SELECT oi.id, oi.product_id, oi.variant_id, oi.quantity
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id$marker$;
  new_cselect text := $marker$  FOR v_item IN
    SELECT oi.id, oi.product_id, oi.variant_id, oi.quantity, oi.offer_line, oi.product_offer_id
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id$marker$;
  old_cbody text := $marker$  LOOP
    SELECT has_variants, variant_model, inventory_tracking_policy, inventory_anchor_variant_id
    INTO v_has_variants, v_variant_model, v_prod_policy, v_anchor_id$marker$;
  new_cbody text := $marker$  LOOP
    -- Offer lines are fulfilled from offer stock: release any stale
    -- reserved units (pre-fix double reservations, possibly
    -- non-expiring), then skip confirmation entirely (no reclaim, no
    -- late-payment reservation error).
    IF v_item.offer_line IS TRUE OR v_item.product_offer_id IS NOT NULL THEN
      DECLARE
        v_release_id uuid;
        v_release_variant_id uuid;
        v_release_product_id uuid;
        v_release_branch_id uuid;
        v_release_from_status text;
      BEGIN
        FOR v_release_id IN
          SELECT vi.id FROM public.variant_inventory vi
          WHERE vi.order_item_id = v_item.id AND vi.status IN ('reserved', 'non-expiring')
          FOR UPDATE
        LOOP
          SELECT vi.variant_id, pv.product_id, vi.branch_id, vi.status
          INTO v_release_variant_id, v_release_product_id, v_release_branch_id, v_release_from_status
          FROM public.variant_inventory vi
          LEFT JOIN public.product_variants pv ON pv.id = vi.variant_id
          WHERE vi.id = v_release_id;
          PERFORM private.record_variant_inventory_event(
            v_release_id, p_merchant_id, COALESCE(v_release_product_id, v_item.product_id), v_release_variant_id, 'reservation_released',
            v_release_from_status, 'available', p_order_id, v_item.id, v_release_branch_id, NULL, NULL,
'{}'::jsonb
          );
          UPDATE public.variant_inventory
          SET status = 'available',
              order_id = NULL,
              order_item_id = NULL,
              reserved_at = NULL,
              reservation_expires_at = NULL,
              updated_at = now()
          WHERE id = v_release_id;
        END LOOP;
        UPDATE public.order_items AS oi
        SET fulfillment_data = jsonb_build_object(
          'source', 'merchant_stock',
          'reservationExpiresAt', NULL,
          'inventoryUnits', '[]'::jsonb,
          'missingUnitCount', v_item.quantity
        )
        WHERE oi.id = v_item.id;
      END;
      CONTINUE;
    END IF;
    SELECT has_variants, variant_model, inventory_tracking_policy, inventory_anchor_variant_id
    INTO v_has_variants, v_variant_model, v_prod_policy, v_anchor_id$marker$;
BEGIN
  SELECT p.oid INTO STRICT function_oid
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private' AND p.proname = 'confirm_order_inventory_reservations' AND p.pronargs = 2;
  definition := pg_catalog.pg_get_functiondef(function_oid);
  IF position(new_cselect IN definition) > 0 AND position(new_cbody IN definition) > 0 THEN RETURN; END IF;
  IF position(old_cselect IN definition) = 0 THEN
    RAISE EXCEPTION 'confirm loop source does not match expected shape';
  END IF;
  IF position(old_cbody IN definition) = 0 THEN
    RAISE EXCEPTION 'confirm body source does not match expected shape';
  END IF;
  IF (length(definition) - length(replace(definition, old_cselect, ''))) <> length(old_cselect) THEN
    RAISE EXCEPTION 'confirm select anchor is not unique';
  END IF;
  IF (length(definition) - length(replace(definition, old_cbody, ''))) <> length(old_cbody) THEN
    RAISE EXCEPTION 'confirm body anchor is not unique';
  END IF;
  definition := replace(definition, old_cselect, new_cselect);
  definition := replace(definition, old_cbody, new_cbody);
  EXECUTE definition;
END $claim_exclusion_confirm_3734$;

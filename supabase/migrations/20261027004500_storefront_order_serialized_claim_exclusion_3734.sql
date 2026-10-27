-- Issue #3734: the serialized-claim exclusion misses offer_id-without-condition
-- lines (double reservation risk).
--
-- private.create_storefront_order_unchecked persists the order line
-- condition as COALESCE(t.offer_condition, t.condition), but the
-- serialized-unit claim loop excludes condition-offer lines by comparing
-- the raw staging condition (t.condition, which falls back to the
-- product condition when the client submits offer_id without a
-- condition) against the persisted oi.condition. When the offer's live
-- condition differs from that fallback, the exclusion misses and
-- private.claim_variant_inventory_units_for_order_item_internal reserves
-- serialized base-product units after the condition-offer stock was
-- already decremented (or raises serialized_inventory_unavailable in
-- strict mode).
--
-- Fix: match the exclusion against the persisted shape,
-- COALESCE(t.offer_condition, t.condition), identical to the insert
-- list. Required source shape is asserted so schema drift fails closed
-- (same pg_get_functiondef string-patch pattern as 15140000).
--
-- The same gap exists in the pending-order reuse path:
-- private.prepare_storefront_order_for_checkout iterates every order
-- item and claims serialized units whenever none are reserved, with no
-- offer-line exclusion at all. An unpaid offer_id-only order (reusable
-- via /api/orders/reuse) would get base-product units claimed on reuse.
-- The reuse loop now selects oi.offer_line (persisted true for
-- offer_id or condition_offer_id lines) and skips the claim for those
-- lines. The reserved-units branch is untouched: with creation fixed,
-- offer lines never hold reservations, and pre-existing ones only get
-- their expiry refreshed, never new claims.
DO $claim_exclusion_3734$
DECLARE
  function_oid oid;
  definition text;
  old_marker text := $marker$        AND NOT EXISTS(SELECT 1 FROM pg_temp.tmp_storefront_order_items t WHERE t.condition_offer_id IS NOT NULL AND t.product_id=oi.product_id AND t.variant_id IS NOT DISTINCT FROM oi.variant_id AND t.condition IS NOT DISTINCT FROM oi.condition)$marker$;
  new_marker text := $marker$        AND NOT EXISTS(SELECT 1 FROM pg_temp.tmp_storefront_order_items t WHERE t.condition_offer_id IS NOT NULL AND t.product_id=oi.product_id AND t.variant_id IS NOT DISTINCT FROM oi.variant_id AND COALESCE(t.offer_condition, t.condition) IS NOT DISTINCT FROM oi.condition)$marker$;
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
DO $claim_exclusion_reuse_3734$
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
    SELECT oi.id, oi.product_id, oi.variant_id, oi.quantity, oi.offer_line
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
  new_claim text := $marker$    ELSIF v_item.offer_line IS DISTINCT FROM TRUE THEN
      PERFORM private.claim_variant_inventory_units_for_order_item_internal(
        p_merchant_id,
        p_order_id,
        v_item.id
      );
    END IF;$marker$;
BEGIN
  SELECT p.oid INTO STRICT function_oid
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private' AND p.proname = 'prepare_storefront_order_for_checkout' AND p.pronargs = 9;
  definition := pg_catalog.pg_get_functiondef(function_oid);
  IF position(new_loop IN definition) > 0 AND position(new_claim IN definition) > 0 THEN RETURN; END IF;
  IF position(old_loop IN definition) = 0 THEN
    RAISE EXCEPTION 'reuse claim loop source does not match expected shape';
  END IF;
  IF position(old_claim IN definition) = 0 THEN
    RAISE EXCEPTION 'reuse claim branch source does not match expected shape';
  END IF;
  IF (length(definition) - length(replace(definition, old_loop, ''))) <> length(old_loop) THEN
    RAISE EXCEPTION 'reuse claim loop anchor is not unique';
  END IF;
  IF (length(definition) - length(replace(definition, old_claim, ''))) <> length(old_claim) THEN
    RAISE EXCEPTION 'reuse claim branch anchor is not unique';
  END IF;
  definition := replace(definition, old_loop, new_loop);
  definition := replace(definition, old_claim, new_claim);
  EXECUTE definition;
END $claim_exclusion_reuse_3734$;

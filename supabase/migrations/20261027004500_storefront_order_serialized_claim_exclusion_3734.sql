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

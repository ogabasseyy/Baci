-- Skip order lines that are not linked to a catalogue product when confirming
-- inventory holds for a paid order.
--
-- Staff can type a line straight onto an in-store invoice ("custom" item),
-- leaving order_items.product_id NULL. Such a line has no stock to hold, but
-- the confirmation loop still called ensure_product_inventory_anchor_variant
-- for it, which raises product_not_found. Every gateway payment for such an
-- invoice was then rolled back to "awaiting payment" even though the money
-- had arrived (ORD-101126-7D8E99, Paystack DVA, 2026-11-10).
--
-- The function body is patched in place, matching
-- 20260927140000_order_claim_loops_by_product_variant, so this change cannot
-- silently revert any other edit to the confirmation logic.
DO $migration$
DECLARE
  v_function_oid oid;
  v_definition text;
  v_updated text;
  v_anchor constant text :=
    'SELECT has_variants, variant_model, inventory_tracking_policy, inventory_anchor_variant_id';
  v_guard constant text :=
    'IF v_item.product_id IS NULL THEN' || chr(10)
    || '      -- Unlinked (custom) line: no catalogue stock to hold.' || chr(10)
    || '      CONTINUE;' || chr(10)
    || '    END IF;' || chr(10) || chr(10) || '    ';
BEGIN
  SELECT function_definition.oid
  INTO v_function_oid
  FROM pg_catalog.pg_proc AS function_definition
  JOIN pg_catalog.pg_namespace AS function_schema
    ON function_schema.oid = function_definition.pronamespace
  WHERE function_schema.nspname = 'private'
    AND function_definition.proname = 'confirm_order_inventory_reservations'
    AND function_definition.pronargs = 2;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'confirm_order_inventory_reservations_function_not_found';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_function_oid)
  INTO v_definition;

  IF pg_catalog.strpos(v_definition, 'IF v_item.product_id IS NULL THEN') > 0 THEN
    RETURN;
  END IF;

  -- The anchor must appear exactly once so the guard lands at the top of the
  -- order-item loop and nowhere else.
  IF (pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor, '')))
     / pg_catalog.length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'confirm_order_inventory_unlinked_item_anchor_not_unique';
  END IF;

  v_updated := pg_catalog.replace(v_definition, v_anchor, v_guard || v_anchor);
  EXECUTE v_updated;
END;
$migration$;

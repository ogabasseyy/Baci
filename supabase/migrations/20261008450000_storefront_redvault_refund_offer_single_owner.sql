-- Restore each REDVAULT-refunded offer scalar in exactly one helper.
-- M26 restores the offer allocation in the quantity path for every
-- processed line and again in the serialized path for every
-- historically-serialized line — but lines that were serialized at
-- order time without being currently serialized_strict (a
-- serialized_then_unlimited line that reserved a unit, or a strict
-- line whose policy later flipped) run through BOTH helpers, so the
-- scalar is restored twice and offer stock inflates on every such
-- partial refund. Gate the serialized-path restore to the lines the
-- quantity helper skips (historically serialized AND currently
-- strict, mirroring its skip predicate verbatim): those lines take
-- their scalar plus unit release here, and every other line takes
-- its scalar from the quantity path alone. Reruns converge via the
-- idempotence check below.
DO $migration$
DECLARE
  v_function_oid oid;
  v_definition text;
  v_updated text;
  v_before text;
BEGIN
  SELECT function_definition.oid
  INTO v_function_oid
  FROM pg_catalog.pg_proc AS function_definition
  JOIN pg_catalog.pg_namespace AS function_schema
    ON function_schema.oid = function_definition.pronamespace
  WHERE function_schema.nspname = 'private'
    AND function_definition.proname =
      'release_redvault_refund_inventory_units'
    AND function_definition.pronargs = 1;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'redvault_refund_inventory_function_not_found';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_function_oid) INTO v_definition;

  -- Reruns and already-patched branches converge without duplicating
  -- edits. Checked first: the patch consumes the unqualified IF below.
  IF strpos(v_definition, 'quantity-skipped lines only') > 0 THEN
    RETURN;
  END IF;

  -- Fail closed when applied before the M26 restore this qualifies.
  IF strpos(v_definition, 'restore alongside the unit') = 0 THEN
    RAISE EXCEPTION 'redvault_refund_inventory_offer_not_found';
  END IF;

  v_before := v_definition;
  v_updated := replace(
    v_definition,
    $$    IF v_item.offer_line IS TRUE THEN
      -- Strict and unlimited offer scalars restore alongside the unit
      -- release: creation decrements them with the claim. A null id
      -- from a deleted offer matches nothing and restores nothing.
      UPDATE public.product_offers AS offer
      SET stock_quantity = offer.stock_quantity + v_request.requested_count
      WHERE offer.id = v_item.offer_id;
    END IF;$$,
    $$    -- The quantity helper already restored this scalar for every line
    -- it processed; this restore covers quantity-skipped lines only
    -- (historically serialized and currently strict).
    IF v_item.offer_line IS TRUE
      AND private.redvault_line_was_serialized(v_order.id, v_item.id)
      AND EXISTS (
        SELECT 1 FROM public.products AS product
        LEFT JOIN public.product_variants AS variant ON variant.id = v_item.variant_id
        WHERE product.id = v_item.product_id
          AND product.inventory_tracking_policy = 'serialized_strict'
          AND (v_item.variant_id IS NULL OR COALESCE(variant.inventory_tracking_policy, 'inherit')
            IN ('inherit', 'serialized_strict'))
      )
    THEN
      -- Strict offer scalars restore alongside the unit release:
      -- creation decrements them with the claim. A null id from a
      -- deleted offer matches nothing and restores nothing.
      UPDATE public.product_offers AS offer
      SET stock_quantity = offer.stock_quantity + v_request.requested_count
      WHERE offer.id = v_item.offer_id;
    END IF;$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'redvault_refund_inventory_offer_gate_not_found';
  END IF;

  EXECUTE v_updated;
END;
$migration$;

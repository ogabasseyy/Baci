-- Restore condition-offer scalars on REDVAULT partial refunds. Order
-- creation decrements the offer allocation for every offer line
-- (quantity-managed and serialized alike), but the refund release
-- functions never restore it: the quantity path routes solely by
-- variant_id, so a non-variant offer line inflates the parent product
-- instead, and the serialized path releases the unit and syncs parent
-- stock without touching the offer row. Route offer lines (M17
-- discriminator, backfilled for historical rows) to product_offers in
-- both paths, unguarded by the parent flag exactly like creation. A
-- null id from a deleted offer matches nothing and restores nothing.
-- Reruns converge via the idempotence check in each block.
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
      'release_redvault_refund_quantity_units'
    AND function_definition.pronargs = 1;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'redvault_refund_quantity_function_not_found';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_function_oid) INTO v_definition;

  -- Reruns and already-patched branches converge without duplicating
  -- edits. Checked first: the patch preserves the anchor below.
  IF strpos(v_definition, 'restore the offer allocation') > 0 THEN
    RETURN;
  END IF;

  v_before := v_definition;
  v_updated := replace(
    v_definition,
    $$    ELSE
      UPDATE public.products AS product
      SET stock_quantity = COALESCE(product.stock_quantity, 0) + v_request.requested_count
      WHERE product.id = v_item.product_id AND product.manage_stock = true;
    END IF;$$,
    $$    ELSIF v_item.offer_line IS TRUE THEN
      -- Offer lines restore the offer allocation (creation decrements it
      -- regardless of the parent flag); a null id from a deleted offer
      -- matches nothing and restores nothing.
      UPDATE public.product_offers AS offer
      SET stock_quantity = offer.stock_quantity + v_request.requested_count
      WHERE offer.id = v_item.offer_id;
    ELSE
      UPDATE public.products AS product
      SET stock_quantity = COALESCE(product.stock_quantity, 0) + v_request.requested_count
      WHERE product.id = v_item.product_id AND product.manage_stock = true;
    END IF;$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'redvault_refund_quantity_offer_not_found';
  END IF;

  EXECUTE v_updated;
END;
$migration$;

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
  -- edits. Checked first: the patch preserves the anchor below.
  IF strpos(v_definition, 'restore alongside the unit') > 0 THEN
    RETURN;
  END IF;

  v_before := v_definition;
  v_updated := replace(
    v_definition,
    $$    PERFORM private.sync_serialized_stock(v_order.merchant_id, v_item.product_id);$$,
    $$    IF v_item.offer_line IS TRUE THEN
      -- Strict and unlimited offer scalars restore alongside the unit
      -- release: creation decrements them with the claim. A null id
      -- from a deleted offer matches nothing and restores nothing.
      UPDATE public.product_offers AS offer
      SET stock_quantity = offer.stock_quantity + v_request.requested_count
      WHERE offer.id = v_item.offer_id;
    END IF;
    PERFORM private.sync_serialized_stock(v_order.merchant_id, v_item.product_id);$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'redvault_refund_inventory_offer_not_found';
  END IF;

  EXECUTE v_updated;
END;
$migration$;

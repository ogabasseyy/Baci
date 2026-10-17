-- Append-only: restore unlimited offer scalars when cancelled.
--
-- M15 excluded serialized policies from the offer-restock branches on the
-- premise that creation skips their scalar decrement. M20 changed half of
-- that premise: creation now decrements the offer scalar for
-- serialized_then_unlimited products (the finite allocation binds the
-- order the same way search, the PDP, and the cart bind availability).
-- Without the mirror half, each order/cancel cycle permanently depletes
-- the allocation until available offer inventory is unpurchasable.
--
-- Fix: drop the serialized_then_unlimited exclusion from all three offer
-- restock branches so cancellation restores what creation decremented.
-- serialized_strict stays excluded: strict creation still bypasses the
-- scalar (units are the source of truth there), so restoring would
-- inflate phantom stock exactly as M15 describes.
--
-- Same pg_get_functiondef patch channel as M15/M17. The anchor is the
-- M15 comment block, deliberately independent of the M17 offer_line
-- routing above it. Fail closed when M15 is absent; reruns converge.
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
    AND function_definition.proname = 'restock_order_items'
    AND function_definition.pronargs = 1;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'storefront_restock_function_not_found';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_function_oid) INTO v_definition;

  -- Reruns and already-patched branches converge without duplicating
  -- edits. Checked first: the patch consumes the M15 marker below.
  IF strpos(v_definition, 'Unlimited offer scalars restock here') > 0 THEN
    RETURN;
  END IF;

  -- Fail closed when applied before the M15 policy filter this refines.
  IF strpos(v_definition, 'Serialized offers restock via units') = 0 THEN
    RAISE EXCEPTION 'storefront_restock_offer_policy_not_found';
  END IF;

  v_before := v_definition;
  v_updated := replace(
    v_definition,
    $$      -- Serialized offers restock via units, never scalar: creation skips
      -- their decrement, so restoring here would inflate phantom stock.
      AND pp.inventory_tracking_policy IS DISTINCT FROM 'serialized_strict'
      AND pp.inventory_tracking_policy IS DISTINCT FROM 'serialized_then_unlimited'$$,
    $$      -- Strict offers restock via units, never scalar: creation skips
      -- their decrement, so restoring here would inflate phantom stock.
      -- Unlimited offer scalars restock here: creation decrements them.
      AND pp.inventory_tracking_policy IS DISTINCT FROM 'serialized_strict'$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_restock_unlimited_offer_not_found';
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
      'restock_order_items_excluding_redvault_releases'
    AND function_definition.pronargs = 1;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'storefront_restock_redvault_function_not_found';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_function_oid) INTO v_definition;

  IF strpos(v_definition, 'Unlimited offer scalars restock here') > 0 THEN
    RETURN;
  END IF;

  IF strpos(v_definition, 'Serialized offers restock via units') = 0 THEN
    RAISE EXCEPTION 'storefront_restock_offer_policy_not_found';
  END IF;

  v_before := v_definition;
  v_updated := replace(
    v_definition,
    $$      -- Serialized offers restock via units, never scalar: creation skips
      -- their decrement, so restoring here would inflate phantom stock.
      AND pp.inventory_tracking_policy IS DISTINCT FROM 'serialized_strict'
      AND pp.inventory_tracking_policy IS DISTINCT FROM 'serialized_then_unlimited'$$,
    $$      -- Strict offers restock via units, never scalar: creation skips
      -- their decrement, so restoring here would inflate phantom stock.
      -- Unlimited offer scalars restock here: creation decrements them.
      AND pp.inventory_tracking_policy IS DISTINCT FROM 'serialized_strict'$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_restock_unlimited_offer_not_found';
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
      'restock_order_items_excluding_serialized'
    AND function_definition.pronargs = 1;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'storefront_restock_serialized_function_not_found';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_function_oid) INTO v_definition;

  IF strpos(v_definition, 'Unlimited offer scalars restock here') > 0 THEN
    RETURN;
  END IF;

  IF strpos(v_definition, 'Serialized offers restock via units') = 0 THEN
    RAISE EXCEPTION 'storefront_restock_offer_policy_not_found';
  END IF;

  v_before := v_definition;
  v_updated := replace(
    v_definition,
    $$      -- Serialized offers restock via units, never scalar: creation skips
      -- their decrement, so restoring here would inflate phantom stock.
      AND pp.inventory_tracking_policy IS DISTINCT FROM 'serialized_strict'
      AND pp.inventory_tracking_policy IS DISTINCT FROM 'serialized_then_unlimited'$$,
    $$      -- Strict offers restock via units, never scalar: creation skips
      -- their decrement, so restoring here would inflate phantom stock.
      -- Unlimited offer scalars restock here: creation decrements them.
      AND pp.inventory_tracking_policy IS DISTINCT FROM 'serialized_strict'$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_restock_unlimited_offer_not_found';
  END IF;

  EXECUTE v_updated;
END;
$migration$;

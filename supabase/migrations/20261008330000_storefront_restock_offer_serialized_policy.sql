-- Exclude serialized policies from the M13 offer-restock branches. Creation
-- deliberately skips the scalar offer-stock decrement for
-- serialized_strict and serialized_then_unlimited products (their inventory
-- moves in serialized units, claimed per order line and released on
-- cancel), but the M13 restock branches added the ordered quantity back
-- unconditionally — so each order/cancel cycle inflated the offer's scalar
-- stock, which unlike the product scalar is read for serialized offers by
-- the PDP, cart, and search guards. Restock must mirror creation: only
-- legacy/off-policy offer lines restore scalar stock.
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

  -- Fail closed when applied before the M13 offer branch this refines.
  IF strpos(lower(v_definition), 'update public.product_offers po') = 0 THEN
    RAISE EXCEPTION 'storefront_restock_offer_branch_not_found';
  END IF;

  -- Reruns and already-patched branches converge without duplicating edits.
  IF strpos(lower(v_definition), 'serialized offers restock via units') > 0 THEN
    RETURN;
  END IF;

  v_before := v_definition;
  v_updated := replace(
    v_definition,
    $$      AND oi.offer_id IS NOT NULL
      AND COALESCE(pp.manage_stock, false) = true
    GROUP BY oi.offer_id$$,
    $$      AND oi.offer_id IS NOT NULL
      AND COALESCE(pp.manage_stock, false) = true
      -- Serialized offers restock via units, never scalar: creation skips
      -- their decrement, so restoring here would inflate phantom stock.
      AND pp.inventory_tracking_policy IS DISTINCT FROM 'serialized_strict'
      AND pp.inventory_tracking_policy IS DISTINCT FROM 'serialized_then_unlimited'
    GROUP BY oi.offer_id$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_restock_offer_policy_not_found';
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

  IF strpos(lower(v_definition), 'update public.product_offers po') = 0 THEN
    RAISE EXCEPTION 'storefront_restock_offer_branch_not_found';
  END IF;

  IF strpos(lower(v_definition), 'serialized offers restock via units') > 0 THEN
    RETURN;
  END IF;

  v_before := v_definition;
  v_updated := replace(
    v_definition,
    $$      AND oi.offer_id IS NOT NULL
      AND COALESCE(pp.manage_stock, false) = true
    GROUP BY oi.offer_id$$,
    $$      AND oi.offer_id IS NOT NULL
      AND COALESCE(pp.manage_stock, false) = true
      -- Serialized offers restock via units, never scalar: creation skips
      -- their decrement, so restoring here would inflate phantom stock.
      AND pp.inventory_tracking_policy IS DISTINCT FROM 'serialized_strict'
      AND pp.inventory_tracking_policy IS DISTINCT FROM 'serialized_then_unlimited'
    GROUP BY oi.offer_id$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_restock_offer_policy_not_found';
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

  IF strpos(lower(v_definition), 'update public.product_offers po') = 0 THEN
    RAISE EXCEPTION 'storefront_restock_offer_branch_not_found';
  END IF;

  IF strpos(lower(v_definition), 'serialized offers restock via units') > 0 THEN
    RETURN;
  END IF;

  -- This helper's offer branch already excludes serialized_strict (mirrored
  -- from its product branch in M13); extend it to serialized_then_unlimited
  -- so restock mirrors creation exactly. Deliberately stricter than this
  -- helper's product branch: offers carry no legacy scalar expectations,
  -- and creation decrements them only for legacy/off-policy products.
  v_before := v_definition;
  v_updated := replace(
    v_definition,
    $$      AND oi.offer_id IS NOT NULL
      AND COALESCE(pp.manage_stock, false) = true
      AND pp.inventory_tracking_policy IS DISTINCT FROM 'serialized_strict'
    GROUP BY oi.offer_id$$,
    $$      AND oi.offer_id IS NOT NULL
      AND COALESCE(pp.manage_stock, false) = true
      -- Serialized offers restock via units, never scalar: creation skips
      -- their decrement, so restoring here would inflate phantom stock.
      AND pp.inventory_tracking_policy IS DISTINCT FROM 'serialized_strict'
      AND pp.inventory_tracking_policy IS DISTINCT FROM 'serialized_then_unlimited'
    GROUP BY oi.offer_id$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_restock_offer_policy_not_found';
  END IF;

  EXECUTE v_updated;
END;
$migration$;

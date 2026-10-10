-- Restore condition-offer scalars on cancellation regardless of the
-- parent stock flag. M22 made creation decrement offer allocations even
-- when the parent product is unmanaged (or NULL), but the offer-restock
-- branch in all three helpers still requires
-- COALESCE(pp.manage_stock, false) = true — so cancelling an order on an
-- unmanaged parent never restores the allocation and the offer depletes
-- permanently. Drop the parent-flag guard from the offer branch only:
-- parent restock keeps it (creation never decrements unmanaged parents),
-- and strict offers still restock via units, never scalar. Reruns
-- converge via the idempotence check in each block.
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
  -- edits. Checked first: the patch consumes the guard line below.
  IF strpos(v_definition, 'Offer scalars restore regardless') > 0 THEN
    RETURN;
  END IF;

  -- Fail closed when applied before the M17 discriminator this refines.
  IF strpos(v_definition, 'AND oi.offer_line IS TRUE') = 0 THEN
    RAISE EXCEPTION 'storefront_restock_offer_line_not_found';
  END IF;

  v_before := v_definition;
  v_updated := replace(
    v_definition,
    $$      AND oi.offer_line IS TRUE
      AND COALESCE(pp.manage_stock, false) = true$$,
    $$      AND oi.offer_line IS TRUE
      -- Offer scalars restore regardless of the parent flag: creation
      -- decrements them even when the parent is unmanaged (M22).$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_restock_offer_managed_guard_not_found';
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

  -- Reruns and already-patched branches converge without duplicating
  -- edits. Checked first: the patch consumes the guard line below.
  IF strpos(v_definition, 'Offer scalars restore regardless') > 0 THEN
    RETURN;
  END IF;

  -- Fail closed when applied before the M17 discriminator this refines.
  IF strpos(v_definition, 'AND oi.offer_line IS TRUE') = 0 THEN
    RAISE EXCEPTION 'storefront_restock_offer_line_not_found';
  END IF;

  v_before := v_definition;
  v_updated := replace(
    v_definition,
    $$      AND oi.offer_line IS TRUE
      AND COALESCE(pp.manage_stock, false) = true$$,
    $$      AND oi.offer_line IS TRUE
      -- Offer scalars restore regardless of the parent flag: creation
      -- decrements them even when the parent is unmanaged (M22).$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_restock_offer_managed_guard_not_found';
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

  -- Reruns and already-patched branches converge without duplicating
  -- edits. Checked first: the patch consumes the guard line below.
  IF strpos(v_definition, 'Offer scalars restore regardless') > 0 THEN
    RETURN;
  END IF;

  -- Fail closed when applied before the M17 discriminator this refines.
  IF strpos(v_definition, 'AND oi.offer_line IS TRUE') = 0 THEN
    RAISE EXCEPTION 'storefront_restock_offer_line_not_found';
  END IF;

  v_before := v_definition;
  v_updated := replace(
    v_definition,
    $$      AND oi.offer_line IS TRUE
      AND COALESCE(pp.manage_stock, false) = true$$,
    $$      AND oi.offer_line IS TRUE
      -- Offer scalars restore regardless of the parent flag: creation
      -- decrements them even when the parent is unmanaged (M22).$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_restock_offer_managed_guard_not_found';
  END IF;

  EXECUTE v_updated;
END;
$migration$;

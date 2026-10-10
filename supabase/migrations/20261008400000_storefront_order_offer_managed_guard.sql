-- Enforce condition-offer allocations independently of the parent stock
-- flag, and treat a NULL parent flag as managed. The stock loop added by
-- the offer-economics patch sits inside `IF stock_rec.manage_stock`, so
-- two configurations silently skip offer enforcement: a product with
-- manage_stock = false creates the order without checking or decrementing
-- product_offers.stock_quantity (a finite allocation oversells), and a
-- product with manage_stock NULL aggregates BOOL_OR to NULL, which skips
-- the whole loop body. Public option predicates treat NULL as managed
-- (only explicit FALSE disables the scalar check), so qualify the guard:
-- offer lines always enter, and the parent/variant path enters unless the
-- flag is explicitly FALSE. Plain unmanaged lines still skip exactly as
-- before. Reruns converge via the idempotence check below.
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
    AND function_definition.proname IN (
      'create_storefront_order',
      'create_storefront_order_unchecked'
    )
    AND function_definition.pronargs = 24
  ORDER BY CASE function_definition.proname
    WHEN 'create_storefront_order_unchecked' THEN 0
    ELSE 1
  END
  LIMIT 1;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'storefront_order_function_not_found';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_function_oid) INTO v_definition;

  -- Fail closed when applied before the M13 offer branch this qualifies.
  IF strpos(v_definition, 'ELSIF stock_rec.offer_id IS NOT NULL THEN') = 0 THEN
    RAISE EXCEPTION 'storefront_order_offer_branch_not_found';
  END IF;

  -- Reruns and already-patched guards converge without duplicating edits.
  IF strpos(v_definition, 'COALESCE(stock_rec.manage_stock, TRUE)') > 0 THEN
    RETURN;
  END IF;

  v_before := v_definition;
  v_updated := replace(
    v_definition,
    $$  LOOP
    IF stock_rec.manage_stock THEN$$,
    $$  LOOP
    -- Offer allocations enforce independently of the parent flag, and a
    -- NULL parent flag means managed (only explicit FALSE disables the
    -- scalar check, matching search and PDP predicates).
    IF COALESCE(stock_rec.manage_stock, TRUE) OR stock_rec.offer_id IS NOT NULL THEN$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_managed_guard_not_found';
  END IF;

  EXECUTE v_updated;
END;
$migration$;

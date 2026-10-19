-- Order the multi-item inventory claim loops by product/unit so checkout
-- acquires product locks in the same order as the serialized release path.
-- Without this, a checkout claiming products B then A can deadlock against a
-- release locking A then B through the stock-sync trigger. Both the initial
-- checkout flow and the pending-order reuse flow iterate order items before
-- claiming, so both loops are patched.
DO $migration$
DECLARE
  v_function_oid oid;
  v_definition text;
  v_updated text;
BEGIN
  SELECT function_definition.oid
  INTO v_function_oid
  FROM pg_catalog.pg_proc AS function_definition
  JOIN pg_catalog.pg_namespace AS function_schema
    ON function_schema.oid = function_definition.pronamespace
  WHERE function_schema.nspname = 'private'
    AND function_definition.proname = 'create_storefront_order_unchecked'
    AND function_definition.pronargs = 24;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'storefront_order_unchecked_function_not_found';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_function_oid)
  INTO v_definition;

  IF pg_catalog.strpos(v_definition, 'ORDER BY oi.product_id, oi.id') > 0 THEN
    RETURN;
  END IF;

  v_updated := pg_catalog.replace(
    v_definition,
    $$    FOR v_item IN
      SELECT oi.id, oi.product_id, oi.variant_id
      FROM public.order_items oi
      WHERE oi.order_id = v_order_id
    LOOP$$,
    $$    FOR v_item IN
      SELECT oi.id, oi.product_id, oi.variant_id
      FROM public.order_items oi
      WHERE oi.order_id = v_order_id
      ORDER BY oi.product_id, oi.id
    LOOP$$
  );
  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'storefront_order_claim_loop_patch_failed';
  END IF;

  EXECUTE v_updated;

  SELECT function_definition.oid
  INTO v_function_oid
  FROM pg_catalog.pg_proc AS function_definition
  JOIN pg_catalog.pg_namespace AS function_schema
    ON function_schema.oid = function_definition.pronamespace
  WHERE function_schema.nspname = 'private'
    AND function_definition.proname = 'prepare_storefront_order_for_checkout'
    AND function_definition.pronargs = 9;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'storefront_order_reuse_function_not_found';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_function_oid)
  INTO v_definition;

  IF pg_catalog.strpos(v_definition, 'ORDER BY oi.product_id, oi.id') > 0 THEN
    RETURN;
  END IF;

  v_updated := pg_catalog.replace(
    v_definition,
    $$  FOR v_item IN
    SELECT oi.id, oi.product_id, oi.variant_id, oi.quantity
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
    FOR UPDATE
  LOOP$$,
    $$  FOR v_item IN
    SELECT oi.id, oi.product_id, oi.variant_id, oi.quantity
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
    ORDER BY oi.product_id, oi.id
    FOR UPDATE
  LOOP$$
  );
  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'storefront_order_reuse_claim_loop_patch_failed';
  END IF;

  EXECUTE v_updated;
END;
$migration$;

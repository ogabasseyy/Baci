-- Regression test: the checkout inventory claim loops must acquire product
-- locks in the same product/unit order as the serialized release path,
-- otherwise a multi-product checkout can deadlock against a release through
-- the stock-sync trigger. Both the initial checkout flow and the
-- pending-order reuse flow iterate order items before claiming, so both
-- loops are checked, and the claim call must sit inside the ordered loop.
-- The paid chat conversion iterates chat items in input order through the
-- same claim delegate, so its loop is ordered by product as well.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/storefront_order_claim_loop_ordering.sql

BEGIN;

DO $$
DECLARE
  v_create_loop text;
  v_reuse_loop text;
  v_chat_loop text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(function_definition.oid)
  INTO v_create_loop
  FROM pg_catalog.pg_proc AS function_definition
  JOIN pg_catalog.pg_namespace AS function_schema
    ON function_schema.oid = function_definition.pronamespace
  WHERE function_schema.nspname = 'private'
    AND function_definition.proname = 'create_storefront_order_unchecked'
    AND function_definition.pronargs = 24;

  IF v_create_loop IS NULL THEN
    RAISE EXCEPTION 'private.create_storefront_order_unchecked is missing';
  END IF;

  IF v_create_loop !~ 'FOR\s+v_item\s+IN\s+SELECT\s+oi\.id\s*,\s*oi\.product_id[^;]*?ORDER\s+BY\s+oi\.product_id\s*,\s*oi\.id\s+LOOP(?:(?!END\s+LOOP).)*claim_variant_inventory_units_for_order_item_internal' THEN
    RAISE EXCEPTION 'storefront claim loop must order items by product/unit';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(function_definition.oid)
  INTO v_reuse_loop
  FROM pg_catalog.pg_proc AS function_definition
  JOIN pg_catalog.pg_namespace AS function_schema
    ON function_schema.oid = function_definition.pronamespace
  WHERE function_schema.nspname = 'private'
    AND function_definition.proname = 'prepare_storefront_order_for_checkout'
    AND function_definition.pronargs = 9;

  IF v_reuse_loop IS NULL THEN
    RAISE EXCEPTION 'private.prepare_storefront_order_for_checkout is missing';
  END IF;

  IF v_reuse_loop !~ 'FOR\s+v_item\s+IN\s+SELECT\s+oi\.id\s*,\s*oi\.product_id[^;]*?ORDER\s+BY\s+oi\.product_id\s*,\s*oi\.id\s+FOR\s+UPDATE\s+LOOP(?:(?!END\s+LOOP).)*claim_variant_inventory_units_for_order_item_internal' THEN
    RAISE EXCEPTION 'storefront reuse claim loop must order items by product/unit';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(function_definition.oid)
  INTO v_chat_loop
  FROM pg_catalog.pg_proc AS function_definition
  JOIN pg_catalog.pg_namespace AS function_schema
    ON function_schema.oid = function_definition.pronamespace
  WHERE function_schema.nspname = 'private'
    AND function_definition.proname = 'convert_chat_order_to_paid_order_with_inventory'
    AND function_definition.pronargs = 5;

  IF v_chat_loop IS NULL THEN
    RAISE EXCEPTION 'private.convert_chat_order_to_paid_order_with_inventory is missing';
  END IF;

  IF v_chat_loop !~ 'FOR\s+v_item\s+IN\s+SELECT\s+\*\s+FROM\s+jsonb_to_recordset\(v_chat_order\.items\)[^;]*?ORDER\s+BY\s+product_id\s+LOOP(?:(?!END\s+LOOP).)*claim_variant_inventory_units_for_order_item_internal' THEN
    RAISE EXCEPTION 'chat claim loop must order items by product';
  END IF;
END
$$;

ROLLBACK;

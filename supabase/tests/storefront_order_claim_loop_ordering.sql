-- Regression test: the checkout inventory claim loop must acquire product
-- locks in the same product/unit order as the serialized release path,
-- otherwise a multi-product checkout can deadlock against a release through
-- the stock-sync trigger.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/storefront_order_claim_loop_ordering.sql

BEGIN;

DO $$
DECLARE
  v_claim_loop text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(function_definition.oid)
  INTO v_claim_loop
  FROM pg_catalog.pg_proc AS function_definition
  JOIN pg_catalog.pg_namespace AS function_schema
    ON function_schema.oid = function_definition.pronamespace
  WHERE function_schema.nspname = 'private'
    AND function_definition.proname = 'create_storefront_order_unchecked'
    AND function_definition.pronargs = 24;

  IF v_claim_loop IS NULL THEN
    RAISE EXCEPTION 'private.create_storefront_order_unchecked is missing';
  END IF;

  IF v_claim_loop !~ 'FOR\s+v_item\s+IN\s+SELECT\s+oi\.id\s*,\s*oi\.product_id\s*,\s*oi\.variant_id\s+FROM\s+public\.order_items\s+oi\s+WHERE\s+oi\.order_id\s*=\s*v_order_id\s+ORDER\s+BY\s+oi\.product_id\s*,\s*oi\.id\s+LOOP' THEN
    RAISE EXCEPTION 'storefront claim loop must order items by product/unit';
  END IF;
END
$$;

ROLLBACK;

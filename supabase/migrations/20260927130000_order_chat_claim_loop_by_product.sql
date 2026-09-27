-- Order the chat-order inventory claim loop by product so the paid chat
-- conversion acquires product locks in the same order as the serialized
-- release path. Without this, a chat order listing products B then A can
-- deadlock against a release locking A then B through the stock-sync
-- trigger, aborting the webhook transaction.
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
    AND function_definition.proname = 'convert_chat_order_to_paid_order_with_inventory'
    AND function_definition.pronargs = 5;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'chat_order_conversion_function_not_found';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_function_oid)
  INTO v_definition;

  IF pg_catalog.strpos(v_definition, 'ORDER BY product_id') > 0 THEN
    RETURN;
  END IF;

  v_updated := pg_catalog.replace(
    v_definition,
    $$  FOR v_item IN
    SELECT * FROM jsonb_to_recordset(v_chat_order.items) AS (
      product_id uuid,
      variant_id uuid,
      name text,
      quantity integer,
      price numeric
    )
  LOOP$$,
    $$  FOR v_item IN
    SELECT * FROM jsonb_to_recordset(v_chat_order.items) AS (
      product_id uuid,
      variant_id uuid,
      name text,
      quantity integer,
      price numeric
    )
    ORDER BY product_id
  LOOP$$
  );
  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'chat_order_claim_loop_patch_failed';
  END IF;

  EXECUTE v_updated;
END;
$migration$;

-- A canonical merge retires the receiving cart and keeps the incoming cart.
-- Move transfer history in the same transaction as the cart lines.
DO $migration$
DECLARE
  redeem_definition text := pg_catalog.pg_get_functiondef(
    'public.commerce_cart_redeem_handoff(text,uuid,text,text,text,uuid,integer,integer,jsonb,jsonb)'::regprocedure
  );
  import_definition text := pg_catalog.pg_get_functiondef(
    'public.commerce_cart_import_mcp_handoff(text,uuid,text,integer)'::regprocedure
  );
  redeem_anchor constant text := ' -- Surface the selected grant''s own expiry';
  move_history constant text := $body$ IF p_choice = 'merge' AND result->>'ok' = 'true'
     AND result->>'replayed' IS DISTINCT FROM 'true'
     AND result->'state'->>'cartId' = handoff.source_cart_id::text
     AND handoff.source_cart_id <> p_dest_cart_id
     AND result->>'grantId' IS NOT NULL THEN
  WITH transferred AS (
    DELETE FROM private.commerce_cart_mcp_imports
    WHERE merchant_id = merchant AND destination_cart_id = p_dest_cart_id
    RETURNING source_cart_id, source_version, source_lines
  )
  INSERT INTO private.commerce_cart_mcp_imports (
    merchant_id, source_cart_id, principal_id, destination_cart_id,
    destination_grant_id, source_version, source_lines
  )
  SELECT merchant, transferred.source_cart_id, claims->>'cart_principal_id',
    handoff.source_cart_id, (result->>'grantId')::uuid,
    transferred.source_version, transferred.source_lines
  FROM transferred
  WHERE transferred.source_cart_id <> handoff.source_cart_id
  ON CONFLICT (merchant_id, source_cart_id, destination_cart_id) DO UPDATE SET
    source_version = greatest(commerce_cart_mcp_imports.source_version, EXCLUDED.source_version),
    source_lines = (
      SELECT jsonb_agg(jsonb_build_object('item', item, 'quantity', quantity) ORDER BY item)
      FROM (
        SELECT line.value->'item' AS item, max((line.value->>'quantity')::integer) AS quantity
        FROM jsonb_array_elements(
          commerce_cart_mcp_imports.source_lines || EXCLUDED.source_lines
        ) line
        GROUP BY line.value->'item'
      ) transferred_quantities
    ),
    principal_id = EXCLUDED.principal_id,
    destination_grant_id = EXCLUDED.destination_grant_id;
 END IF;
$body$;
  import_anchor constant text := '  IF scope = ''session'' OR replayed OR prior_import.source_version IS NOT NULL THEN';
  reload_history constant text := $body$  -- A canonical merge may have moved the import history while this
  -- request waited for the destination lock.
  IF scope = 'session' AND NOT replayed THEN
    SELECT i.* INTO prior_import
    FROM private.commerce_cart_mcp_imports i
    WHERE i.merchant_id = merchant AND i.source_cart_id = handoff.source_cart_id
      AND i.destination_cart_id = destination_id;
  END IF;
$body$;
BEGIN
  IF position(redeem_anchor IN redeem_definition) = 0
     OR position(import_anchor IN import_definition) = 0 THEN
    RAISE EXCEPTION 'MCP cart import merge continuity source mismatch';
  END IF;
  EXECUTE replace(redeem_definition, redeem_anchor, move_history || redeem_anchor);
  EXECUTE replace(import_definition, import_anchor, reload_history || import_anchor);
END $migration$;

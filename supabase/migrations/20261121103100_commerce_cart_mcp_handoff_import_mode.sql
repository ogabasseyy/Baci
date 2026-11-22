-- Import-only links may copy lines into a separate website cart. Only
-- ordinary handoffs can connect or merge into the source cart.
DO $migration$
DECLARE
  importer text := pg_catalog.pg_get_functiondef(
    'public.commerce_cart_import_mcp_handoff(text,uuid,text,integer)'::regprocedure
  );
  redeemer text := pg_catalog.pg_get_functiondef(
    'public.commerce_cart_redeem_handoff(text,uuid,text,text,text,uuid,integer,integer,jsonb,jsonb)'::regprocedure
  );
  import_source constant text := $body$AND h.operation_id LIKE 'legacy-handoff:%'$body$;
  import_only_source constant text := $body$AND h.operation_id LIKE 'legacy-handoff:mcp-import:%'$body$;
  redeem_anchor constant text := $body$ IF p_choice='merge' THEN$body$;
  redeem_guard constant text := $body$ -- Match the token and merchant before deciding which writer may use it.
 IF EXISTS (
   SELECT 1 FROM public.commerce_cart_handoffs h
   WHERE h.id = p_handoff_id AND h.handoff_hash = p_token_hash
     AND h.merchant_id = (claims->>'cart_merchant_id')::uuid
     AND h.destination->>'type' = 'web'
     AND h.origin_principal_id LIKE 'legacy:mcp:%'
     AND h.operation_id LIKE 'legacy-handoff:mcp-import:%'
 ) THEN
   RETURN jsonb_build_object('ok',false,'code','not_found','state',null,'replayed',false);
 END IF;
 IF p_choice='merge' THEN$body$;
BEGIN
  IF position(import_source IN importer) = 0 OR position(redeem_anchor IN redeemer) = 0 THEN
    RAISE EXCEPTION 'MCP cart handoff mode source mismatch';
  END IF;
  EXECUTE replace(importer, import_source, import_only_source);
  EXECUTE replace(redeemer, redeem_anchor, redeem_guard);
END $migration$;

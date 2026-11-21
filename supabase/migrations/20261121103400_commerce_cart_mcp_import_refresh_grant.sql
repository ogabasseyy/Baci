-- Keep bootstrap recovery bound to the most recent verified website grant.
DO $migration$
DECLARE
  definition text := pg_catalog.pg_get_functiondef(
    'public.commerce_cart_import_mcp_handoff(text,uuid,text,integer)'::regprocedure
  );
  old_update constant text :=
    'DO UPDATE SET source_version = EXCLUDED.source_version, source_lines = EXCLUDED.source_lines;';
  new_update constant text := $body$DO UPDATE SET
    source_version = EXCLUDED.source_version, source_lines = EXCLUDED.source_lines,
    principal_id = EXCLUDED.principal_id, destination_grant_id = EXCLUDED.destination_grant_id;$body$;
BEGIN
  IF position(old_update IN definition) = 0 THEN
    RAISE EXCEPTION 'MCP cart import grant refresh source mismatch';
  END IF;
  EXECUTE replace(definition, old_update, new_update);
END $migration$;

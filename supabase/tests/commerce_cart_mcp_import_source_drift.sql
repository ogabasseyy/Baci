-- An additional textual match must abort the migration before rewriting.
CREATE FUNCTION pg_temp.check_mcp_import_source_drift(repair text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  definition text := pg_get_functiondef(
    'public.commerce_cart_import_mcp_handoff(text,uuid,text,integer)'::regprocedure
  );
  anchor text;
BEGIN
  FOREACH anchor IN ARRAY ARRAY[
    'discovery.canonical_product_condition(variant.condition)',
    'item.identity->''options'' = ''{}''::jsonb',
    'variant.attributes = ''{}''::jsonb',
    'destination_line.options = copy.value->''item''->''options'''
  ] LOOP
    BEGIN
      EXECUTE regexp_replace(definition, 'DECLARE', 'DECLARE /* ' || anchor || ' */');
      EXECUTE repair;
      RAISE EXCEPTION 'MCP import migration accepted a duplicate anchor: %', anchor;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'MCP cart import inherited variant source mismatch' THEN RAISE; END IF;
    END;
  END LOOP;
END $$;

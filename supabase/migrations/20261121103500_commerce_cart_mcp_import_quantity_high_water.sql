-- Website imports are additive. Decreasing a source quantity does not
-- remove website units and must not make those units eligible to copy again.
DO $migration$
DECLARE
  definition text := pg_catalog.pg_get_functiondef(
    'public.commerce_cart_import_mcp_handoff(text,uuid,text,integer)'::regprocedure
  );
  old_baseline constant text :=
    'source_version = EXCLUDED.source_version, source_lines = EXCLUDED.source_lines,';
  new_baseline constant text := $body$source_version = EXCLUDED.source_version,
    source_lines = (
      SELECT jsonb_agg(jsonb_build_object('item', item, 'quantity', quantity) ORDER BY item)
      FROM (
        SELECT line.value->'item' AS item, max((line.value->>'quantity')::integer) AS quantity
        FROM jsonb_array_elements(
          commerce_cart_mcp_imports.source_lines || EXCLUDED.source_lines
        ) line
        GROUP BY line.value->'item'
      ) transferred
    ),$body$;
BEGIN
  IF position(old_baseline IN definition) = 0 THEN
    RAISE EXCEPTION 'MCP cart import quantity baseline source mismatch';
  END IF;
  EXECUTE replace(definition, old_baseline, new_baseline);
END $migration$;

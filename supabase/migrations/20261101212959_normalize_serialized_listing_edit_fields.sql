-- Normalize only the listing blocks needed by the following append-only
-- edit-fields migration. Existing installed function bodies may use CRLF.
DO $$
DECLARE
  definition text := pg_catalog.pg_get_functiondef(
    'private.list_variant_inventory_units(uuid,uuid,uuid,text,text,uuid,integer,timestamptz,uuid)'::regprocedure
  );
  block text;
  crlf_block text;
  lf_count integer;
  crlf_count integer;
BEGIN
  FOREACH block IN ARRAY ARRAY[
    E'      vi.id,\n      pv.product_id,',
    E'        ''id'', v_row.id,\n        ''product_id'', v_row.product_id,'
  ] LOOP
    crlf_block := replace(block, E'\n', E'\r\n');
    lf_count := (length(definition) - length(replace(definition, block, ''))) / length(block);
    crlf_count := (length(definition) - length(replace(definition, crlf_block, ''))) / length(crlf_block);
    IF lf_count + crlf_count <> 1 THEN
      RAISE EXCEPTION 'serialized inventory listing edit fields source mismatch';
    END IF;
    IF crlf_count = 1 THEN
      definition := replace(definition, crlf_block, block);
    END IF;
  END LOOP;
  EXECUTE definition;
END;
$$;

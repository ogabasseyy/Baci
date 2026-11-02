-- Reproduce a previously installed function whose body uses CRLF line endings.
DO $$
DECLARE
  definition text := pg_get_functiondef(
    'private.list_variant_inventory_units(uuid,uuid,uuid,text,text,uuid,integer,timestamptz,uuid)'::regprocedure
  );
BEGIN
  EXECUTE replace(definition, E'\n', E'\r\n');
END;
$$;

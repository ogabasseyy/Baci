-- Reproduce an installed function body with CRLF line endings.
DO $$
DECLARE definition text := pg_get_functiondef('private.delete_variant_inventory_unit(uuid,uuid)'::regprocedure);
BEGIN
  EXECUTE replace(definition, E'\n', E'\r\n');
END $$;

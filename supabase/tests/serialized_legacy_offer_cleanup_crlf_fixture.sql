DO $$
DECLARE definition text := pg_get_functiondef('private.release_stale_offer_line_serialized_units(uuid,uuid,uuid,uuid,jsonb)'::regprocedure);
BEGIN EXECUTE replace(definition, E'\n', E'\r\n'); END $$;

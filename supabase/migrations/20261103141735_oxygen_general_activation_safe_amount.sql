-- Preserve the activation binding check while rejecting malformed persisted
-- provider amounts with its existing serialization failure, including during
-- reconciliation after confirmed evidence has already been recorded.
DO $migration$
DECLARE
 definition text;
 needle text := $old$(s->'booking'->>'product_amount')::numeric IS DISTINCT FROM o.total$old$;
 replacement text := $new$(CASE WHEN pg_catalog.pg_input_is_valid(s->'booking'->>'product_amount','numeric')
  THEN (s->'booking'->>'product_amount')::numeric IS DISTINCT FROM o.total ELSE true END)$new$;
BEGIN
 definition := pg_catalog.pg_get_functiondef('oxygen_private.general_activation(text,uuid,jsonb)'::regprocedure);
 IF (length(definition) - length(replace(definition,needle,''))) / length(needle) <> 1 THEN
  RAISE EXCEPTION 'Unexpected general activation definition';
 END IF;
 EXECUTE replace(definition,needle,replacement);
END $migration$;

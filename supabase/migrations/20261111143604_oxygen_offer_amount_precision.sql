DO $migration$
DECLARE
  definition text;
  marker constant text := '  INSERT INTO oxygen_private.provider_states(workflow_id,state)';
BEGIN
  definition := pg_catalog.pg_get_functiondef('oxygen_private.runtime(text,uuid,jsonb)'::regprocedure);
  IF position(marker IN definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected Oxygen runtime definition';
  END IF;
  definition := replace(definition, marker, $check$
  IF p_payload->'state' ? 'offers' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_payload->'state'->'offers') o
    WHERE (o->>'loanAmount')::numeric <> trunc((o->>'loanAmount')::numeric, 2)
  ) THEN
    RAISE EXCEPTION 'Eligibility offer has excess precision' USING ERRCODE='22023';
  END IF;
$check$ || marker);
  EXECUTE definition;
END $migration$;

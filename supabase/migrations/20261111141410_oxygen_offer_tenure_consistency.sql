-- The lender may quote a per-period ceiling above the overall ceiling; the
-- effective limit remains the lower of the two. Reject impossible periods.
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
  IF p_payload->'state' ? 'offers' AND p_payload->'state' ? 'maxTenure'
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'state'->'offers') o
       WHERE (o->>'tenure')::numeric > (p_payload->'state'->>'maxTenure')::numeric) THEN
    RAISE EXCEPTION 'Eligibility offer exceeds maximum tenure' USING ERRCODE='22023';
  END IF;
$check$ || marker);
  EXECUTE definition;
END $migration$;

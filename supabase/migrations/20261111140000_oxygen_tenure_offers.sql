-- Preserve the existing worker and ownership checks while extending the bounded
-- provider state accepted by the runtime. Existing applications are unchanged.
DO $migration$
DECLARE
  definition text;
  needle constant text := '''minimumAmount'',''maxTenure'',''kyc''';
  replacement constant text := '''minimumAmount'',''maxTenure'',''offers'',''kyc''';
  marker constant text := '  INSERT INTO oxygen_private.provider_states(workflow_id,state)';
BEGIN
  definition := pg_catalog.pg_get_functiondef('oxygen_private.runtime(text,uuid,jsonb)'::regprocedure);
  IF position(needle IN definition) = 0 OR position(marker IN definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected Oxygen runtime definition';
  END IF;
  definition := replace(definition, needle, replacement);
  definition := replace(definition, marker, $check$
  IF p_payload->'state' ? 'offers' AND (
    jsonb_typeof(p_payload->'state'->'offers') IS DISTINCT FROM 'array' OR
    jsonb_array_length(p_payload->'state'->'offers') NOT BETWEEN 1 AND 12 OR
    EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'state'->'offers') o
      WHERE jsonb_typeof(o) IS DISTINCT FROM 'object'
        OR (o - ARRAY['loanAmount','tenure']) <> '{}'::jsonb
        OR jsonb_typeof(o->'loanAmount') IS DISTINCT FROM 'number'
        OR jsonb_typeof(o->'tenure') IS DISTINCT FROM 'number'
        OR (o->>'loanAmount')::numeric <= 0
        OR (o->>'loanAmount')::numeric > 90071992547409
        OR (o->>'tenure')::numeric NOT BETWEEN 1 AND 12
        OR (o->>'tenure')::numeric <> trunc((o->>'tenure')::numeric)) OR
    (SELECT count(DISTINCT (o->>'tenure')::numeric) FROM jsonb_array_elements(p_payload->'state'->'offers') o)
      <> jsonb_array_length(p_payload->'state'->'offers')
  ) THEN
    RAISE EXCEPTION 'Invalid eligibility offers' USING ERRCODE='22023';
  END IF;
$check$ || marker);
  EXECUTE definition;
END $migration$;

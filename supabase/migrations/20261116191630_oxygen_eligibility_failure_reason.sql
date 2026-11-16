-- Persist a bounded customer-facing reason, never provider text.
-- Preserve the installed runtime's worker and customer ownership checks.
DO $migration$
DECLARE
  definition text;
  needle constant text := '''validated'',''eligible'',''eligibilityStatus'',''eligibleAmount''';
  replacement constant text := '''validated'',''eligible'',''eligibilityStatus'',''eligibilityFailureReason'',''eligibleAmount''';
  marker constant text := '  INSERT INTO oxygen_private.provider_states(workflow_id,state)';
BEGIN
  definition := pg_catalog.pg_get_functiondef('oxygen_private.runtime(text,uuid,jsonb)'::regprocedure);
  IF position(needle IN definition) = 0 OR position(marker IN definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected Oxygen runtime definition';
  END IF;
  definition := replace(definition, needle, replacement);
  definition := replace(definition, marker, $check$
  IF p_payload->'state' ? 'eligibilityFailureReason' AND (
    jsonb_typeof(p_payload->'state'->'eligibilityFailureReason') IS DISTINCT FROM 'string'
    OR p_payload->'state'->>'eligibilityFailureReason' <> 'financial_details_mismatch'
    OR p_payload->'state'->>'eligibilityStatus' IS DISTINCT FROM 'failed'
    OR p_payload->'state' ? 'eligible'
  ) THEN
    RAISE EXCEPTION 'Invalid eligibility failure reason' USING ERRCODE='22023';
  END IF;
$check$ || marker);
  EXECUTE definition;
END $migration$;

-- Keep the bounded reason outside the strict state read by older deployments.
ALTER TABLE oxygen_private.provider_states
  ADD COLUMN eligibility_failure_reason text
  CHECK (eligibility_failure_reason IS NULL OR eligibility_failure_reason = 'financial_details_mismatch');

-- Preserve the runtime's existing worker and customer ownership checks.
DO $migration$
DECLARE
  definition text;
  needle constant text := '''validated'',''eligible'',''eligibilityStatus'',''eligibleAmount''';
  replacement constant text := '''validated'',''eligible'',''eligibilityStatus'',''eligibilityFailureReason'',''eligibleAmount''';
  read_marker constant text := ' v_state:=coalesce(v_state,''{}'');';
  insert_marker constant text := '  INSERT INTO oxygen_private.provider_states(workflow_id,state)';
  write_marker constant text := $write_marker$  INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES(w.id,p_payload->'state')
   ON CONFLICT(workflow_id) DO UPDATE SET state=excluded.state;$write_marker$;
BEGIN
  definition := pg_catalog.pg_get_functiondef('oxygen_private.runtime(text,uuid,jsonb)'::regprocedure);
  IF length(definition) - length(replace(definition, needle, '')) <> length(needle)
     OR length(definition) - length(replace(definition, read_marker, '')) <> length(read_marker)
     OR length(definition) - length(replace(definition, insert_marker, '')) <> length(insert_marker)
     OR length(definition) - length(replace(definition, write_marker, '')) <> length(write_marker) THEN
    RAISE EXCEPTION 'Unexpected Oxygen runtime definition';
  END IF;
  definition := replace(definition, needle, replacement);
  definition := replace(definition, read_marker, read_marker || $read$
 IF p_operation='status' AND p_payload->'includeEligibilityFailureReason'='true'::jsonb
    AND v_state->>'eligibilityStatus'='failed' AND NOT (v_state ? 'eligible') THEN
  v_state:=v_state || jsonb_strip_nulls(jsonb_build_object('eligibilityFailureReason',
   (SELECT eligibility_failure_reason FROM oxygen_private.provider_states WHERE workflow_id=w.id)));
 END IF;
$read$);
  definition := replace(definition, write_marker, $write$
  IF p_payload->'state' ? 'eligibilityFailureReason' AND (
    c.command->>'action' IS DISTINCT FROM 'refresh_eligibility'
    OR jsonb_typeof(p_payload->'state'->'eligibilityFailureReason') IS DISTINCT FROM 'string'
    OR p_payload->'state'->>'eligibilityFailureReason' <> 'financial_details_mismatch'
    OR p_payload->'state'->>'eligibilityStatus' IS DISTINCT FROM 'failed'
    OR p_payload->'state' ? 'eligible'
  ) THEN
    RAISE EXCEPTION 'Invalid eligibility failure reason' USING ERRCODE='22023';
  END IF;
  INSERT INTO oxygen_private.provider_states AS saved (workflow_id,state,eligibility_failure_reason)
   VALUES(w.id,(p_payload->'state')-'eligibilityFailureReason',p_payload->'state'->>'eligibilityFailureReason')
   ON CONFLICT(workflow_id) DO UPDATE SET
    state=excluded.state,
    eligibility_failure_reason=CASE
     WHEN c.command->>'action'='refresh_eligibility' THEN excluded.eligibility_failure_reason
     WHEN excluded.state->>'eligibilityStatus'='failed' AND NOT (excluded.state ? 'eligible') THEN saved.eligibility_failure_reason
     ELSE NULL END;
$write$);
  EXECUTE definition;
END $migration$;

-- Keep progress separate from the strict provider state used by older workers.
ALTER TABLE oxygen_private.provider_states
  ADD COLUMN eligibility_progress text
  CHECK (eligibility_progress IN ('bank_statement', 'credit_score', 'eligibility_review'));

DO $migration$
DECLARE
  definition text;
  projection constant text := '''eligibilityStatus'',''eligibilityFailureReason'',''eligibleAmount''';
  read_marker constant text := ' v_state:=coalesce(v_state,''{}'');';
  state_marker constant text := $state$(p_payload->'state')-'eligibilityFailureReason'$state$;
  write_marker constant text := '     ELSE NULL END;';
BEGIN
  definition := pg_catalog.pg_get_functiondef('oxygen_private.runtime(text,uuid,jsonb)'::regprocedure);
  IF length(definition) - length(replace(definition, projection, '')) <> length(projection)
     OR length(definition) - length(replace(definition, read_marker, '')) <> length(read_marker)
     OR length(definition) - length(replace(definition, state_marker, '')) <> length(state_marker)
     OR length(definition) - length(replace(definition, write_marker, '')) <> length(write_marker) THEN
    RAISE EXCEPTION 'Unexpected Oxygen runtime definition';
  END IF;
  definition := replace(definition, projection,
    '''eligibilityStatus'',''eligibilityFailureReason'',''eligibilityProgress'',''eligibleAmount''');
  definition := replace(definition, read_marker, read_marker || $read$
 IF p_operation='status' AND p_payload->'includeEligibilityProgress'='true'::jsonb
    AND v_state->>'eligibilityStatus'='pending' AND NOT (v_state ? 'eligible') THEN
  v_state:=v_state || jsonb_strip_nulls(jsonb_build_object('eligibilityProgress',
   (SELECT eligibility_progress FROM oxygen_private.provider_states WHERE workflow_id=w.id)));
 END IF;
$read$);
  definition := replace(definition,
    state_marker,
    $state$(p_payload->'state')-ARRAY['eligibilityFailureReason','eligibilityProgress']$state$);
  definition := replace(definition, write_marker, write_marker || $write$
  IF p_payload->'state' ? 'eligibilityProgress' AND (
    c.command->>'action' IS DISTINCT FROM 'refresh_eligibility'
    OR jsonb_typeof(p_payload->'state'->'eligibilityProgress') IS DISTINCT FROM 'string'
    OR p_payload->'state'->>'eligibilityProgress' NOT IN ('bank_statement','credit_score','eligibility_review')
    OR p_payload->'state'->>'eligibilityStatus' IS DISTINCT FROM 'pending'
    OR p_payload->'state' ? 'eligible'
  ) THEN
    RAISE EXCEPTION 'Invalid eligibility progress' USING ERRCODE='22023';
  END IF;
  IF c.command->>'action'='refresh_eligibility'
     OR p_payload->'state'->>'eligibilityStatus' IS DISTINCT FROM 'pending' THEN
    UPDATE oxygen_private.provider_states SET eligibility_progress=
     CASE WHEN c.command->>'action'='refresh_eligibility' THEN p_payload->'state'->>'eligibilityProgress' END
    WHERE workflow_id=w.id;
  END IF;
$write$);
  EXECUTE definition;
END $migration$;

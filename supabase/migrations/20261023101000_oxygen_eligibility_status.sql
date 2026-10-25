-- Persist only a bounded presentation status; raw provider messages stay private.
-- Preserve the installed runtime function's tenant/worker checks and other guards.
DO $migration$
DECLARE
  definition text;
  needle constant text := '''validated'',''eligible'',''eligibleAmount''';
  replacement constant text := '''validated'',''eligible'',''eligibilityStatus'',''eligibleAmount''';
  marker constant text := '  INSERT INTO oxygen_private.provider_states(workflow_id,state)';
BEGIN
  definition := pg_get_functiondef('oxygen_private.runtime(text,uuid,jsonb)'::regprocedure);
  IF position(needle IN definition) = 0 OR position(marker IN definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected Oxygen runtime definition';
  END IF;
  definition := replace(definition, needle, replacement);
  definition := replace(definition, marker,
    '  IF p_payload->''state'' ? ''eligibilityStatus'' AND
      (jsonb_typeof(p_payload->''state''->''eligibilityStatus'') IS DISTINCT FROM ''string'' OR
       p_payload->''state''->>''eligibilityStatus'' NOT IN (''pending'',''failed'',''completed'')) THEN
      RAISE EXCEPTION ''Invalid eligibility status'' USING ERRCODE=''22023'';
    END IF;
' || marker);
  EXECUTE definition;
END $migration$;

-- Queued commands cannot have reached the provider: claiming is atomic and
-- changes status before dispatch. Preserve same-key resume and never reclaim
-- an executing eligibility assessment without a confirmed provider contract.
CREATE FUNCTION oxygen_private.retire_stale_queued_eligibility(p_workflow uuid,p_key uuid)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 UPDATE oxygen_private.commands SET status='failed',completed_at=clock_timestamp()
 WHERE workflow_id=p_workflow AND command->>'action'='refresh_eligibility'
  AND status='queued' AND idempotency_key IS DISTINCT FROM p_key
  AND created_at<clock_timestamp()-interval '2 minutes';
$$;
REVOKE ALL ON FUNCTION oxygen_private.retire_stale_queued_eligibility(uuid,uuid) FROM PUBLIC,anon,authenticated;
DO $$ DECLARE definition text; needle text;
BEGIN
 definition:=pg_get_functiondef('oxygen_private.runtime(text,uuid,jsonb)'::regprocedure);
 needle:='  IF v_action IN (''refresh_kyc'',''refresh_details'') AND v_version=w.version THEN';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected Oxygen runtime read guard'; END IF;
 definition:=replace(definition,needle,$replacement$
  IF v_action='refresh_eligibility' AND v_version=w.version THEN
   PERFORM oxygen_private.retire_stale_queued_eligibility(w.id,v_key);
  END IF;
  IF v_action IN ('refresh_kyc','refresh_details') AND v_version=w.version THEN$replacement$);
 EXECUTE definition;
END $$;
NOTIFY pgrst,'reload schema';

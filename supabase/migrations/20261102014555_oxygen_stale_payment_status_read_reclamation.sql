-- Invoked only after the caller locks the workflow. This operation sends no
-- provider request and never retires financial or uncertain mutations.
CREATE FUNCTION oxygen_private.retire_stale_payment_status_read(p_workflow uuid)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 UPDATE oxygen_private.commands SET status='failed',completed_at=clock_timestamp()
 WHERE workflow_id=p_workflow AND status='executing'
  AND command->>'action'='refresh_payment_setup'
  AND started_at IS NOT NULL AND started_at<clock_timestamp()-interval '2 minutes';
$$;
REVOKE ALL ON FUNCTION oxygen_private.retire_stale_payment_status_read(uuid) FROM PUBLIC,anon,authenticated;

DO $$ DECLARE definition text; needle text;
BEGIN
 definition:=pg_get_functiondef('oxygen_private.payment_recovery_access(text,uuid,jsonb)'::regprocedure);
 needle:=' IF p_operation NOT IN (''evidence'',''evidence_read'') AND (current_ref IS NULL';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected recovery guard'; END IF;
 definition:=replace(definition,needle,$replacement$
 -- A validated, explicitly requested status check may retire a stale read.
 IF p_operation='enqueue' AND p_payload->>'action'='check_status'
  AND p_payload-ARRAY['workflowId','reference','version','idempotencyKey','action']='{}'::jsonb
  AND p_payload->>'workflowId'=w.id::text AND p_payload->>'reference'=current_ref::text
  AND p_payload->>'version'=w.version::text AND (p_payload->>'idempotencyKey')::uuid IS NOT NULL
 THEN PERFORM oxygen_private.retire_stale_payment_status_read(w.id); END IF;
 IF p_operation NOT IN ('evidence','evidence_read') AND (current_ref IS NULL$replacement$);
 EXECUTE definition;

 definition:=pg_get_functiondef('oxygen_private.callback_payment(uuid,uuid,uuid)'::regprocedure);
 needle:=' SELECT o.cancelled_at,o.currency,o.payment_method INTO cancelled,currency,payment_method FROM public.orders o';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected callback guard'; END IF;
 definition:=replace(definition,needle,$replacement$
 PERFORM oxygen_private.retire_stale_payment_status_read(w.id);
 SELECT o.cancelled_at,o.currency,o.payment_method INTO cancelled,currency,payment_method FROM public.orders o$replacement$);
 EXECUTE definition;

 definition:=pg_get_functiondef('oxygen_private.runtime(text,uuid,jsonb)'::regprocedure);
 needle:='  SELECT id,workflow_id,idempotency_key,expected_version,channel,command,status,created_at,started_at,completed_at INTO c';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected runtime enqueue'; END IF;
 definition:=replace(definition,needle,$replacement$
  IF v_action='refresh_payment_setup' AND v_version=w.version THEN
   PERFORM oxygen_private.retire_stale_payment_status_read(w.id);
  END IF;
  SELECT id,workflow_id,idempotency_key,expected_version,channel,command,status,created_at,started_at,completed_at INTO c$replacement$);
 EXECUTE definition;
END $$;
NOTIFY pgrst,'reload schema';
